import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { disposableDatabaseUrl } from './verify-review-database.mjs';

const { Pool, DatabaseError } = pg;
const NOW = '2030-01-01T00:00:00.000Z';

// Evidence is append-only: this runner retains synthetic rows; discard its disposable DB afterwards.
async function main() {
  const pool = new Pool({
    connectionString: disposableDatabaseUrl(),
    max: 4,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  const tutor = randomUUID();
  const students = Array.from({ length: 12 }, () => randomUUID());
  const subject = randomUUID();
  const grade = randomUUID();
  const listing = randomUUID();
  let slotSequence = 0;

  async function rejected(operation, code) {
    await assert.rejects(operation, (error) => {
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.code, code);
      return true;
    });
  }

  async function coupon(maxUses = 2, overrides = {}, client = pool) {
    const row = {
      id: randomUUID(),
      code: randomUUID().replaceAll('-', ''),
      percent: 10,
      maxUses,
      ...overrides,
    };
    await client.query(
      `INSERT INTO "Coupon" ("id", "code", "percent", "expiresAt", "maxUses", "updatedAt") VALUES ($1, $2, $3, '2031-01-01Z', $4, $5)`,
      [row.id, row.code, row.percent, row.maxUses, NOW],
    );
    return row.id;
  }

  async function booking(student = students[0], zero = false) {
    const id = randomUUID();
    const slot = randomUUID();
    slotSequence += 1;
    const start = new Date(Date.UTC(2030, 0, 2 + slotSequence, 10));
    await pool.query(
      `INSERT INTO "AvailabilitySlot" ("id", "tutorProfileId", "startAtUtc", "endAtUtc") VALUES ($1, $2, $3, $4)`,
      [slot, tutor, start, new Date(start.getTime() + 3600000)],
    );
    await pool.query(
      `INSERT INTO "Booking" ("id", "studentUserId", "tutorProfileId", "listingId", "slotId", "status", "subtotalAmount", "discountAmount", "netAmount", "updatedAt") VALUES ($1, $2, $3, $4, $5, 'confirmed', 100, $6, $7, $8)`,
      [id, student, tutor, listing, slot, zero ? 100 : 0, zero ? 0 : 100, NOW],
    );
    return { id, student };
  }

  async function attempt(b, status = 'CREATING') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO "PaymentAttempt" ("id", "bookingId", "amount", "currency", "status", "chargeId", "paidAt", "updatedAt") VALUES ($1, $2, 100, 'THB', $3, $4, $5, $6)`,
      [
        id,
        b.id,
        status,
        status === 'CREATING' ? null : `chrg_test_${id.replaceAll('-', '')}`,
        status === 'SUCCESSFUL' ? NOW : null,
        NOW,
      ],
    );
    return id;
  }

  async function reserve(c, b, a, overrides = {}, client = pool) {
    const row = {
      id: randomUUID(),
      student: b.student,
      amount: '10.00',
      status: 'RESERVED',
      consumedAt: null,
      releasedAt: null,
      ...overrides,
    };
    await client.query(
      `INSERT INTO "CouponReservation" ("id", "couponId", "bookingId", "studentUserId", "paymentAttemptId", "discountAmount", "status", "createdAt", "consumedAt", "releasedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        c,
        b.id,
        row.student,
        a,
        row.amount,
        row.status,
        NOW,
        row.consumedAt,
        row.releasedAt,
      ],
    );
    return row.id;
  }

  async function terminal(a, status) {
    await pool.query(
      `UPDATE "PaymentAttempt" SET "status" = $2, "chargeId" = $3, "paidAt" = $4 WHERE "id" = $1`,
      [a, status, `chrg_test_${a.replaceAll('-', '')}`, status === 'SUCCESSFUL' ? NOW : null],
    );
  }

  function transition(id, status, client = pool) {
    return client.query(
      `UPDATE "CouponReservation" SET "status" = $2::"CouponReservationStatus", "consumedAt" = CASE WHEN $2::text = 'CONSUMED' THEN $3::timestamptz END, "releasedAt" = CASE WHEN $2::text = 'RELEASED' THEN $3::timestamptz END WHERE "id" = $1`,
      [id, status, NOW],
    );
  }

  async function counts(c) {
    const result = await pool.query(
      `SELECT (SELECT count(*)::int FROM "CouponUse" WHERE "couponId" = $1) AS used, (SELECT count(*)::int FROM "CouponReservation" WHERE "couponId" = $1 AND "status" = 'RESERVED') AS reserved`,
      [c],
    );
    return result.rows[0];
  }

  async function race(firstWrite, secondWrite, expectedCode, repeatableRead = false) {
    const first = await pool.connect();
    const second = await pool.connect();
    let pending;
    try {
      await first.query('BEGIN');
      await second.query(repeatableRead ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
      await second.query('SELECT count(*) FROM "Coupon"');
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await firstWrite(first);
      pending = secondWrite(second).then(
        () => null,
        (error) => error,
      );
      const deadline = Date.now() + 5000;
      while (
        !(await pool.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]))
          .rows[0].blocked
      ) {
        assert.ok(Date.now() < deadline, 'Expected actual lock contention');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await first.query('COMMIT');
      const error = await pending;
      if (expectedCode) {
        await rejected(() => Promise.reject(error), expectedCode);
      } else {
        assert.equal(error, null);
        await second.query('COMMIT');
      }
    } finally {
      await first.query('ROLLBACK');
      await pending;
      await second.query('ROLLBACK');
      first.release();
      second.release();
    }
  }

  try {
    const migrations = await readdir(new URL('../prisma/migrations/', import.meta.url), {
      withFileTypes: true,
    });
    const applied = await pool.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    for (const entry of migrations.filter((entry) => entry.isDirectory())) {
      assert.ok(
        applied.rows.some((row) => row.migration_name === entry.name),
        `Missing migration: ${entry.name}`,
      );
    }
    for (const [id, role] of [[tutor, 'tutor'], ...students.map((id) => [id, 'student'])]) {
      await pool.query(
        'INSERT INTO "User" ("id", "email", "role", "updatedAt") VALUES ($1, $2, $3, $4)',
        [id, `coupon-${id}@example.test`, role, NOW],
      );
    }
    await pool.query(
      `INSERT INTO "TutorProfile" ("userId", "displayName", "bio", "experienceYears", "updatedAt") VALUES ($1, 'Synthetic coupon tutor', 'Test', 1, $2)`,
      [tutor, NOW],
    );
    await pool.query(
      'INSERT INTO "Subject" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, $2)',
      [subject, NOW],
    );
    await pool.query(
      'INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, 1, $2)',
      [grade, NOW],
    );
    await pool.query(
      `INSERT INTO "TeachingListing" ("id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description", "updatedAt") VALUES ($1, $2, $3, $4, 100, 'Synthetic coupon listing', $5)`,
      [listing, tutor, subject, grade, NOW],
    );

    await coupon(1, { percent: 1 });
    await coupon(1, { percent: 100 });
    for (const percent of [0, 101, null]) {
      await rejected(() => coupon(1, { percent }), percent === null ? '23502' : '23514');
    }
    await rejected(() => coupon(1, { percent: '1.5' }), '22P02');
    await rejected(() => coupon(0), '23514');
    await rejected(() => coupon(1, { code: '' }), '23514');
    await rejected(() => coupon(1, { code: '\t\u00a0\ufeff' }), '23514');
    const normalized = randomUUID().replaceAll('-', '');
    const normalizedId = await coupon(1, { code: `\t\u00a0${normalized.toLowerCase()}\ufeff` });
    assert.equal(
      (await pool.query('SELECT code FROM "Coupon" WHERE id = $1', [normalizedId])).rows[0].code,
      normalized.toUpperCase(),
    );
    await rejected(() => coupon(1, { code: normalized.toUpperCase() }), '23505');
    const collision = randomUUID().replaceAll('-', '');
    await race(
      (client) => coupon(1, { code: collision.toLowerCase() }, client),
      (client) => coupon(1, { code: collision.toUpperCase() }, client),
      '23505',
    );
    process.stdout.write('Coupon boundaries and normalized concurrent code collision passed.\n');

    const c = await coupon(5);
    const b = await booking();
    const a = await attempt(b);
    for (const amount of ['-0.01', 'NaN', null]) {
      await rejected(() => reserve(c, b, a, { amount }), amount === null ? '23502' : '23514');
    }
    await rejected(() => reserve(c, b, a, { student: students[1] }), '23503');
    await rejected(() => reserve(c, b, null), '23514');
    await rejected(() => reserve(c, b, a, { status: 'CONSUMED', consumedAt: NOW }), '23514');
    const wrongBooking = await booking(students[1]);
    await rejected(() => reserve(c, wrongBooking, a), '23503');
    const r = await reserve(c, b, a);
    await rejected(() => reserve(c, b, a, { id: r }), '23505');
    assert.equal(
      (
        await pool.query(
          `INSERT INTO "CouponReservation" SELECT * FROM "CouponReservation" WHERE id = $1 ON CONFLICT (id) DO NOTHING`,
          [r],
        )
      ).rowCount,
      0,
    );
    await rejected(() => reserve(c, b, a, { id: r, amount: '9.00' }), '23514');
    await rejected(() => transition(r, 'RELEASED'), '23514');
    await rejected(() => transition(r, 'CONSUMED'), '23514');
    await rejected(
      () => pool.query('UPDATE "CouponReservation" SET "discountAmount" = 9 WHERE id = $1', [r]),
      '23514',
    );
    await terminal(a, 'EXPIRED');
    await transition(r, 'RELEASED');
    await transition(r, 'RELEASED');
    assert.deepEqual(await counts(c), { used: 0, reserved: 0 });
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityId" = $1 AND action = 'coupon.release'`,
          [r],
        )
      ).rows[0].n,
      1,
    );
    await rejected(() => transition(r, 'CONSUMED'), '23514');
    const retryAttempt = await attempt(b);
    const retry = await reserve(c, b, retryAttempt, { amount: '0.00' });
    await terminal(retryAttempt, 'SUCCESSFUL');
    await transition(retry, 'CONSUMED');
    await transition(retry, 'CONSUMED');
    assert.deepEqual(await counts(c), { used: 1, reserved: 0 });
    assert.equal(
      (
        await pool.query(
          `INSERT INTO "CouponReservation" SELECT * FROM "CouponReservation" WHERE id = $1 ON CONFLICT (id) DO NOTHING`,
          [retry],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (await pool.query('SELECT "discountAmount" FROM "CouponUse" WHERE "bookingId" = $1', [b.id]))
        .rows[0].discountAmount,
      '0.00',
    );
    const repeatedStudent = await booking();
    await rejected(
      async () => reserve(c, repeatedStudent, await attempt(repeatedStudent)),
      '23505',
    );
    const otherCoupon = await coupon();
    await rejected(() => reserve(otherCoupon, b, retryAttempt), '23505');
    await rejected(
      () =>
        pool.query(
          `INSERT INTO "CouponUse" (id, "couponId", "bookingId", "studentUserId", "discountAmount") VALUES ($1, $2, $3, $4, 1)`,
          [randomUUID(), c, repeatedStudent.id, repeatedStudent.student],
        ),
      '23514',
    );
    await rejected(
      () =>
        pool.query('UPDATE "Booking" SET "studentUserId" = $2 WHERE id = $1', [b.id, students[1]]),
      '23503',
    );
    await rejected(
      () =>
        pool.query('UPDATE "PaymentAttempt" SET "bookingId" = $2 WHERE id = $1', [
          retryAttempt,
          wrongBooking.id,
        ]),
      '23503',
    );
    process.stdout.write(
      'Identity, state, terminal-provider evidence, retry and permanent claim checks passed.\n',
    );

    const cap = await coupon(1);
    const b1 = await booking(students[1]);
    const b2 = await booking(students[2]);
    const a1 = await attempt(b1);
    const a2 = await attempt(b2);
    let capReservation;
    await race(
      async (client) => {
        capReservation = await reserve(cap, b1, a1, {}, client);
      },
      (client) => reserve(cap, b2, a2, {}, client),
      '23514',
    );
    assert.deepEqual(await counts(cap), { used: 0, reserved: 1 });
    await terminal(a1, 'SUCCESSFUL');
    await transition(capReservation, 'CONSUMED');
    await rejected(() => reserve(cap, b2, a2), '23514');
    assert.deepEqual(await counts(cap), { used: 1, reserved: 0 });

    const rrCoupon = await coupon(1);
    const rr1 = await booking(students[3]);
    const rr2 = await booking(students[4]);
    const ra1 = await attempt(rr1);
    const ra2 = await attempt(rr2);
    await race(
      (client) => reserve(rrCoupon, rr1, ra1, {}, client),
      (client) => reserve(rrCoupon, rr2, ra2, {}, client),
      '40001',
      true,
    );
    const studentCoupon = await coupon(5);
    const s1 = await booking(students[5]);
    const s2 = await booking(students[5]);
    const sa1 = await attempt(s1);
    const sa2 = await attempt(s2);
    await race(
      (client) => reserve(studentCoupon, s1, sa1, {}, client),
      (client) => reserve(studentCoupon, s2, sa2, {}, client),
      '23505',
    );
    const sameBooking = await booking(students[6]);
    const sameAttempt = await attempt(sameBooking);
    const bc1 = await coupon();
    const bc2 = await coupon();
    await race(
      (client) => reserve(bc1, sameBooking, sameAttempt, {}, client),
      (client) => reserve(bc2, sameBooking, sameAttempt, {}, client),
      '23505',
    );
    const lower = await coupon(3);
    const l1 = await booking(students[7]);
    const l2 = await booking(students[8]);
    await reserve(lower, l1, await attempt(l1));
    const la2 = await attempt(l2);
    await race(
      (client) => reserve(lower, l2, la2, {}, client),
      (client) => client.query('UPDATE "Coupon" SET "maxUses" = 1 WHERE id = $1', [lower]),
      '23514',
    );
    // Same-settlement concurrent retries must commit one evidence row and one event.
    await race(
      (client) => transition(capReservation, 'CONSUMED', client),
      (client) => transition(capReservation, 'CONSUMED', client),
      null,
    );
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityId" = $1 AND action = 'coupon.consume'`,
          [capReservation],
        )
      ).rows[0].n,
      1,
    );
    const free = await coupon(1);
    const fb1 = await booking(students[1]);
    const fb2 = await booking(students[2]);
    const fa1 = await attempt(fb1);
    const fa2 = await attempt(fb2);
    const fr = await reserve(free, fb1, fa1);
    await terminal(fa1, 'FAILED');
    await race(
      (client) => transition(fr, 'RELEASED', client),
      (client) => reserve(free, fb2, fa2, {}, client),
      null,
    );
    assert.deepEqual(await counts(free), { used: 0, reserved: 1 });
    process.stdout.write(
      'Observed capacity, stale snapshot, student claim, booking claim and maxUses races passed.\n',
    );

    const zeroCoupon = await coupon(1);
    const zero = await booking(students[9], true);
    const zeroId = await reserve(zeroCoupon, zero, null, {
      status: 'CONSUMED',
      consumedAt: NOW,
      amount: '100.00',
    });
    assert.deepEqual(await counts(zeroCoupon), { used: 1, reserved: 0 });
    await transition(zeroId, 'CONSUMED');
    const zeroNonzero = await booking(students[10]);
    await rejected(
      async () =>
        reserve(await coupon(), zeroNonzero, null, { status: 'CONSUMED', consumedAt: NOW }),
      '23514',
    );

    const client = await pool.connect();
    const rollbackCoupon = await coupon();
    const rb = await booking(students[10]);
    const rollbackAttempt = await attempt(rb, 'SUCCESSFUL');
    const rollbackReservation = await reserve(rollbackCoupon, rb, rollbackAttempt);
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('hktutor.audit_actor_user_id', $1, true), set_config('hktutor.audit_request_id', 'coupon-db02-test', true)`,
        [students[0]],
      );
      await transition(rollbackReservation, 'CONSUMED', client);
      await client.query('ROLLBACK');
      assert.deepEqual(await counts(rollbackCoupon), { used: 0, reserved: 1 });
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityId" = $1 AND action = 'coupon.consume'`,
            [rollbackReservation],
          )
        ).rows[0].n,
        0,
      );
      // Force the audit insert to fail after CouponUse insertion; the whole statement must roll back.
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('hktutor.audit_request_id', 'https://unsafe.example/private', true)`,
      );
      await rejected(() => transition(rollbackReservation, 'CONSUMED', client), '23514');
      await client.query('ROLLBACK');
      assert.deepEqual(await counts(rollbackCoupon), { used: 0, reserved: 1 });
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('hktutor.audit_actor_user_id', $1, true), set_config('hktutor.audit_request_id', 'coupon-db02-test', true)`,
        [students[0]],
      );
      await transition(rollbackReservation, 'CONSUMED', client);
      await client.query('COMMIT');
      const audit = (
        await pool.query(
          `SELECT * FROM "AuditLog" WHERE "entityId" = $1 AND action = 'coupon.consume'`,
          [rollbackReservation],
        )
      ).rows[0];
      assert.equal(audit.actorUserId, students[0]);
      assert.equal(audit.requestId, 'coupon-db02-test');
      assert.deepEqual(audit.beforeData, { status: 'RESERVED' });
      assert.deepEqual(audit.afterData, { status: 'CONSUMED', discountAmount: 10 });
      await rejected(
        () => pool.query('UPDATE "AuditLog" SET action = action WHERE id = $1', [audit.id]),
        '23514',
      );
      await rejected(() => pool.query('DELETE FROM "AuditLog" WHERE id = $1', [audit.id]), '23514');
      const unsafeAuditEntity = randomUUID();
      await rejected(
        () =>
          pool.query(
            `INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "operationKey", "afterData") VALUES ($1, 'coupon.consume', 'CouponReservation', $2, $3, '{"status":"CONSUMED","discountAmount":10,"qrCodeUrl":"https://unsafe.example"}')`,
            [randomUUID(), unsafeAuditEntity, `coupon.consume:${unsafeAuditEntity}`],
          ),
        '23514',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    for (const afterData of [
      {},
      { status: null, discountAmount: 10 },
      { status: 'CONSUMED', discountAmount: null },
      { status: 'CONSUMED', discountAmount: 'private-contact' },
      { status: 'CONSUMED', discountAmount: -1 },
      { status: 'CONSUMED', discountAmount: 0.001 },
    ]) {
      const entity = randomUUID();
      await assert.rejects(() =>
        pool.query(
          `INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "operationKey", "afterData") VALUES ($1, 'coupon.consume', 'CouponReservation', $2, $3, $4::jsonb)`,
          [randomUUID(), entity, `coupon.consume:${entity}`, JSON.stringify(afterData)],
        ),
      );
    }
    for (const table of ['Coupon', 'CouponReservation', 'CouponUse', 'AuditLog']) {
      await rejected(() => pool.query(`TRUNCATE "${table}" CASCADE`), '23514');
      const security = (
        await pool.query(
          `SELECT relrowsecurity, EXISTS(SELECT 1 FROM aclexplode(relacl) WHERE grantee = 0) AS public_access FROM pg_class WHERE oid = $1::regclass`,
          [`"${table}"`],
        )
      ).rows[0];
      assert.equal(security.relrowsecurity, true);
      assert.equal(security.public_access, false);
      assert.equal(
        (
          await pool.query(
            `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') AND has_table_privilege(rolname, $1, 'SELECT, INSERT, UPDATE, DELETE')`,
            [`"${table}"`],
          )
        ).rowCount,
        0,
      );
    }
    await rejected(() => pool.query('DELETE FROM "CouponUse" WHERE "id" = $1', [zeroId]), '23514');
    await rejected(
      () => pool.query('UPDATE "CouponUse" SET "discountAmount" = 0 WHERE "id" = $1', [zeroId]),
      '23514',
    );
    await rejected(
      () => pool.query('DELETE FROM "CouponReservation" WHERE "id" = $1', [zeroId]),
      '23514',
    );
    await rejected(() => pool.query('DELETE FROM "Coupon" WHERE "id" = $1', [zeroCoupon]), '23514');
    const indexes = (
      await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`)
    ).rows.map((row) => row.indexname);
    for (const name of [
      'Coupon_code_key',
      'Coupon_createdAt_id_idx',
      'CouponUse_bookingId_key',
      'CouponUse_couponId_studentUserId_key',
      'CouponReservation_student_claim_key',
      'CouponReservation_active_booking_key',
      'CouponReservation_paymentAttemptId_key',
      'CouponReservation_couponId_status_idx',
      'AuditLog_entity_time_idx',
      'AuditLog_operationKey_key',
      'PaymentAttempt_one_active_per_booking',
      'PaymentAttempt_one_success_per_booking',
      'RescheduleRequest_pending_booking_key',
    ]) {
      assert.ok(indexes.includes(name), `Missing index: ${name}`);
    }
    process.stdout.write(
      'Zero settlement, audit atomicity/rollback, safe JSON, append-only evidence, RLS/grants and indexes passed.\n',
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    // Do not print connection strings or raw driver details.
    process.stderr.write(
      `Coupon verification failed: ${error instanceof DatabaseError ? error.code : error instanceof Error ? error.message : 'unknown failure'}\n`,
    );
    process.exitCode = 1;
  }
}

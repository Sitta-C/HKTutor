import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import pg from 'pg';

import { disposableDatabaseUrl } from './verify-review-database.mjs';

const MIGRATION = '20261111120000_add_booking_coupon_snapshots';
const RETRY_MIGRATION = '20261111160000_preserve_coupon_reservation_retries';
const NOW = '2030-01-01T00:00:00.000Z';
const { Pool, DatabaseError } = pg;

// This upgrade harness replays migrations only into an explicitly opted-in, EMPTY disposable DB.
// Synthetic append-only evidence is retained. Discard the database/container after verification.
async function main() {
  const pool = new Pool({
    connectionString: disposableDatabaseUrl(),
    max: 4,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  const tutor = randomUUID();
  const student = randomUUID();
  const subject = randomUUID();
  const grade = randomUUID();
  const listing = randomUUID();
  let sequence = 0;

  async function rejected(run, code = '23514') {
    await assert.rejects(run, (error) => {
      assert.ok(error instanceof DatabaseError);
      assert.equal(error.code, code);
      return true;
    });
  }

  async function transaction(run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await run(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function booking({
    discount = 0,
    net = 450,
    status = 'confirmed',
    paid = false,
    reference = null,
  } = {}) {
    const id = randomUUID();
    const slot = randomUUID();
    sequence += 1;
    const start = new Date(Date.UTC(2030, 0, sequence + 2, 10));
    await pool.query(
      `INSERT INTO "AvailabilitySlot" (id, "tutorProfileId", "startAtUtc", "endAtUtc") VALUES ($1,$2,$3,$4)`,
      [slot, tutor, start, new Date(start.getTime() + 3600000)],
    );
    await pool.query(
      `INSERT INTO "Booking" (id,"studentUserId","tutorProfileId","listingId","slotId",status,
        "subtotalAmount","discountAmount","netAmount","paymentStatus","mockReference","paidAt","updatedAt",
        "canceledById","cancellationReason","canceledAt")
       VALUES ($1,$2,$3,$4,$5,$6,450,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        student,
        tutor,
        listing,
        slot,
        status,
        discount,
        net,
        paid ? 'paid' : 'unpaid',
        reference,
        paid ? NOW : null,
        NOW,
        status === 'canceled' ? student : null,
        status === 'canceled' ? 'Synthetic cancellation' : null,
        status === 'canceled' ? NOW : null,
      ],
    );
    return id;
  }

  async function coupon(percent) {
    const id = randomUUID();
    const code = id.replaceAll('-', '').toUpperCase();
    await pool.query(
      `INSERT INTO "Coupon" (id,code,percent,"expiresAt","maxUses","updatedAt") VALUES ($1,$2,$3,'2031-01-01Z',10,$4)`,
      [id, code, percent, NOW],
    );
    return { id, code, percent };
  }

  async function apply(id, c, client = pool) {
    await client.query(
      `UPDATE "Booking" SET "appliedCouponId"=$2,"appliedCouponCode"=$3,"appliedCouponPercent"=$4::integer,
       "discountAmount"=round("subtotalAmount"*$4::integer/100,2),"netAmount"="subtotalAmount"-round("subtotalAmount"*$4::integer/100,2) WHERE id=$1`,
      [id, c.id, c.code, c.percent],
    );
  }

  async function attempt(id, client = pool) {
    const a = randomUUID();
    await client.query(
      `INSERT INTO "PaymentAttempt" (id,"bookingId",amount,currency,"updatedAt","appliedCouponId","appliedCouponCode","appliedCouponPercent")
       SELECT $2,id,"netAmount",currency,$3,"appliedCouponId","appliedCouponCode","appliedCouponPercent" FROM "Booking" WHERE id=$1`,
      [id, a, NOW],
    );
    return a;
  }

  async function evidence(table, after = false) {
    const subtraction = after
      ? ` - ARRAY['appliedCouponId','appliedCouponCode','appliedCouponPercent']`
      : '';
    // JSONB text includes all original columns, not just amounts; numeric values remain exact.
    return (
      await pool.query(
        `SELECT (to_jsonb(t)${subtraction})::text AS evidence FROM "${table}" t ORDER BY id`,
      )
    ).rows;
  }

  try {
    assert.equal(
      (await pool.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`))
        .rows[0].n,
      0,
      'Upgrade harness requires an empty database; it never resets an existing one',
    );
    const root = new URL('../prisma/migrations/', import.meta.url);
    const names = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.equal(names.at(-1), RETRY_MIGRATION, 'Update the harness when adding later migrations');
    assert.ok(names.includes(MIGRATION));
    for (const name of names.filter((name) => name < MIGRATION)) {
      await pool.query(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
    }
    for (const [id, role] of [
      [tutor, 'tutor'],
      [student, 'student'],
    ]) {
      await pool.query(`INSERT INTO "User" (id,email,role,"updatedAt") VALUES ($1,$2,$3,$4)`, [
        id,
        `${id}@example.test`,
        role,
        NOW,
      ]);
    }
    await pool.query(
      `INSERT INTO "TutorProfile" ("userId","displayName",bio,"experienceYears","updatedAt") VALUES ($1,'Snapshot tutor','Synthetic',1,$2)`,
      [tutor, NOW],
    );
    await pool.query(
      `INSERT INTO "Subject" (id,code,name,"updatedAt") VALUES ($1::uuid,$1::text,'Snapshot subject',$2)`,
      [subject, NOW],
    );
    await pool.query(
      `INSERT INTO "GradeLevel" (id,code,name,"sortOrder","updatedAt") VALUES ($1::uuid,$1::text,'Snapshot grade',1,$2)`,
      [grade, NOW],
    );
    await pool.query(
      `INSERT INTO "TeachingListing" (id,"tutorProfileId","subjectId","gradeLevelId","pricePerHour",description,"updatedAt") VALUES ($1,$2,$3,$4,999,'Current price deliberately differs', $5)`,
      [listing, tutor, subject, grade, NOW],
    );
    await booking({ paid: true, reference: 'LEGACY-MOCK' });
    await booking({
      discount: 45,
      net: 405,
      status: 'completed',
      paid: true,
      reference: 'LEGACY-DISCOUNT',
    });
    await booking({
      discount: 450,
      net: 0,
      status: 'completed',
      paid: true,
      reference: 'LEGACY-ZERO',
    });
    await booking({ status: 'canceled' });
    const moved = await booking();
    const targetBooking = await booking();
    const reschedule = randomUUID();
    await pool.query(
      `INSERT INTO "RescheduleRequest" (id,"bookingId","requestedById","fromSlotId","requestedSlotId",reason,"requestedAt") SELECT $2,b.id,b."studentUserId",b."slotId",t."slotId",'Historical reschedule',$4 FROM "Booking" b,"Booking" t WHERE b.id=$1 AND t.id=$3`,
      [moved, reschedule, targetBooking, NOW],
    );
    await pool.query(
      `UPDATE "RescheduleRequest" SET status='approved',"reviewedById"=$2,"decidedAt"=$3 WHERE id=$1`,
      [reschedule, tutor, NOW],
    );
    // Move to an unoccupied slot after releasing the target fixture's booking.
    await pool.query(`UPDATE "Booking" SET status='expired' WHERE id=$1`, [targetBooking]);
    await pool.query(
      `UPDATE "Booking" b SET "slotId"=t."slotId" FROM "Booking" t WHERE b.id=$1 AND t.id=$2`,
      [moved, targetBooking],
    );
    for (const state of ['CREATING', 'PENDING', 'SUCCESSFUL', 'FAILED']) {
      const b = await booking();
      const a = randomUUID();
      const charge = state === 'CREATING' ? null : `chrg_test_${a.replaceAll('-', '')}`;
      await pool.query(
        `INSERT INTO "PaymentAttempt" (id,"bookingId",amount,currency,status,"chargeId","paidAt","updatedAt") VALUES ($1,$2,450,'THB',$3,$4,$5,$6)`,
        [a, b, state, charge, state === 'SUCCESSFUL' ? NOW : null, NOW],
      );
      if (state === 'SUCCESSFUL') {
        await pool.query(
          `UPDATE "Booking" SET "paymentStatus"='paid',"paidAt"=$2,"paymentReference"=$3 WHERE id=$1`,
          [b, NOW, charge],
        );
      } else if (state === 'CREATING' || state === 'PENDING') {
        await pool.query(`UPDATE "Booking" SET "paymentPending"=true WHERE id=$1`, [b]);
      }
    }
    const oldBookings = await evidence('Booking');
    const oldAttempts = await evidence('PaymentAttempt');
    const indexes = (
      await pool.query(
        `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`,
      )
    ).rows;
    const constraints = (
      await pool.query(
        `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('"Booking"'::regclass,'"PaymentAttempt"'::regclass) AND conname <> 'Booking_payment_fields_check' ORDER BY conname`,
      )
    ).rows;
    await pool.query(await readFile(new URL(`${MIGRATION}/migration.sql`, root), 'utf8'));
    assert.deepEqual(await evidence('Booking', true), oldBookings);
    assert.deepEqual(await evidence('PaymentAttempt', true), oldAttempts);
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "Booking" WHERE "appliedCouponId" IS NOT NULL OR "appliedCouponCode" IS NOT NULL OR "appliedCouponPercent" IS NOT NULL`,
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM "PaymentAttempt" WHERE "appliedCouponId" IS NOT NULL OR "appliedCouponCode" IS NOT NULL OR "appliedCouponPercent" IS NOT NULL`,
        )
      ).rows[0].n,
      0,
    );
    const newIndexes = (
      await pool.query(
        `SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname`,
      )
    ).rows;
    for (const index of indexes) {
      assert.ok(
        newIndexes.some(
          (row) => row.indexname === index.indexname && row.indexdef === index.indexdef,
        ),
      );
    }
    const newConstraints = (
      await pool.query(
        `SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('"Booking"'::regclass,'"PaymentAttempt"'::regclass) ORDER BY conname`,
      )
    ).rows;
    for (const constraint of constraints) {
      assert.ok(
        newConstraints.some(
          (row) => row.conname === constraint.conname && row.definition === constraint.definition,
        ),
      );
    }
    process.stdout.write(
      'Old-to-new upgrade: all original booking/attempt fields, indexes and money checks retained; coupon defaults null.\n',
    );

    const c = await coupon(10);
    const b = await booking();
    await apply(b, c);
    assert.deepEqual(
      (
        await pool.query(
          `SELECT "subtotalAmount","discountAmount","netAmount" FROM "Booking" WHERE id=$1`,
          [b],
        )
      ).rows[0],
      { subtotalAmount: '450.00', discountAmount: '45.00', netAmount: '405.00' },
    );
    for (const sql of [
      `"discountAmount"=451,"netAmount"=-1`,
      `"netAmount"=406`,
      `currency='USD'`,
      `"netAmount"='NaN'`,
      `"appliedCouponCode"=NULL`,
      `"appliedCouponPercent"=0`,
      `"appliedCouponPercent"=101`,
      `"appliedCouponCode"='FAKE'`,
      `"appliedCouponPercent"=100`,
    ]) {
      await rejected(() => pool.query(`UPDATE "Booking" SET ${sql} WHERE id=$1`, [b]));
    }
    await rejected(() => apply(b, { ...c, id: randomUUID() }), '23503');
    const unsupported = await booking();
    await rejected(() =>
      pool.query(`UPDATE "Booking" SET "discountAmount"=450,"netAmount"=0 WHERE id=$1`, [
        unsupported,
      ]),
    );
    const a = await attempt(b);
    await rejected(() => pool.query(`UPDATE "PaymentAttempt" SET amount=400 WHERE id=$1`, [a]));
    await rejected(() =>
      pool.query(
        `UPDATE "Booking" SET "appliedCouponId"=NULL,"appliedCouponCode"=NULL,"appliedCouponPercent"=NULL,"discountAmount"=0,"netAmount"=450 WHERE id=$1`,
        [b],
      ),
    );
    await rejected(() =>
      pool.query(
        `INSERT INTO "PaymentAttempt" (id,"bookingId",amount,currency,"updatedAt") VALUES ($1,$2,0,'THB',$3)`,
        [randomUUID(), unsupported, NOW],
      ),
    );
    await pool.query(`UPDATE "Coupon" SET code='RENAMED',percent=20 WHERE id=$1`, [c.id]);
    assert.equal(
      (await pool.query(`SELECT "appliedCouponCode" FROM "Booking" WHERE id=$1`, [b])).rows[0]
        .appliedCouponCode,
      c.code,
    );
    assert.equal(
      (await pool.query(`SELECT "appliedCouponPercent" FROM "PaymentAttempt" WHERE id=$1`, [a]))
        .rows[0].appliedCouponPercent,
      10,
    );
    const use = randomUUID();
    await rejected(() =>
      pool.query(
        `INSERT INTO "CouponReservation" (id,"couponId","bookingId","studentUserId","paymentAttemptId","discountAmount") VALUES ($1,$2,$3,$4,$5,44)`,
        [use, c.id, b, student, a],
      ),
    );
    await transaction(async (client) => {
      await client.query(`UPDATE "Booking" SET "paymentPending"=true WHERE id=$1`, [b]);
      await client.query(
        `INSERT INTO "CouponReservation" (id,"couponId","bookingId","studentUserId","paymentAttemptId","discountAmount","createdAt") VALUES ($1,$2,$3,$4,$5,45,$6)`,
        [use, c.id, b, student, a, NOW],
      );
      await client.query(
        `UPDATE "PaymentAttempt" SET status='SUCCESSFUL',"chargeId"=$2,"paidAt"=$3 WHERE id=$1`,
        [a, `chrg_test_${a.replaceAll('-', '')}`, NOW],
      );
      await client.query(
        `UPDATE "CouponReservation" SET status='CONSUMED',"consumedAt"=$2 WHERE id=$1`,
        [use, NOW],
      );
      await client.query(
        `UPDATE "Booking" SET "paymentPending"=false,"paymentStatus"='paid',"paidAt"=$2,"paymentReference"=$3 WHERE id=$1`,
        [b, NOW, `chrg_test_${a.replaceAll('-', '')}`],
      );
    });
    assert.equal(
      (await pool.query(`SELECT "discountAmount" FROM "CouponUse" WHERE id=$1`, [use])).rows[0]
        .discountAmount,
      '45.00',
    );
    await rejected(() =>
      pool.query(
        `UPDATE "Booking" SET "subtotalAmount"=500,"discountAmount"=50,"netAmount"=450 WHERE id=$1`,
        [b],
      ),
    );
    process.stdout.write(
      '450/45/405, invalid snapshots/money, immutable attempts, live coupon edits and consumed amount passed.\n',
    );

    const full = await coupon(100);
    const zero = await booking();
    await apply(zero, full);
    await rejected(() =>
      transaction(async (client) => {
        await client.query(
          `UPDATE "Booking" SET "paymentStatus"='paid',"paidAt"=$2,"paymentReference"=$3 WHERE id=$1`,
          [zero, NOW, `coupon:${randomUUID()}`],
        );
      }),
    );
    const zeroUse = randomUUID();
    await transaction(async (client) => {
      await client.query(
        `UPDATE "Booking" SET "paymentStatus"='paid',"paidAt"=$2,"paymentReference"=$3 WHERE id=$1`,
        [zero, NOW, `coupon:${zeroUse}`],
      );
      await client.query(
        `INSERT INTO "CouponReservation" (id,"couponId","bookingId","studentUserId","discountAmount",status,"createdAt","consumedAt") VALUES ($1,$2,$3,$4,450,'CONSUMED',$5,$5)`,
        [zeroUse, full.id, zero, student, NOW],
      );
    });
    assert.equal(
      (
        await pool.query(`SELECT count(*)::int AS n FROM "PaymentAttempt" WHERE "bookingId"=$1`, [
          zero,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await pool.query(`SELECT "netAmount" FROM "Booking" WHERE id=$1`, [zero])).rows[0].netAmount,
      '0.00',
    );
    await rejected(() =>
      transaction(async (client) => {
        await client.query(`UPDATE "Booking" SET "paymentReference"=$2 WHERE id=$1`, [
          zero,
          `coupon:${randomUUID()}`,
        ]);
      }),
    );
    process.stdout.write(
      '450/450/0 settles with one matching CouponUse and no provider attempt; forged receipts rejected.\n',
    );

    // Reproduce the review's released-operation replay on the already-applied DB03 version.
    const retryCoupon = await coupon(10);
    const retryBooking = await booking();
    await apply(retryBooking, retryCoupon);
    const retryAttempt = await attempt(retryBooking);
    const retryId = randomUUID();
    async function retryReservation(overrides = {}, client = pool) {
      const input = {
        id: retryId,
        coupon: retryCoupon.id,
        booking: retryBooking,
        student,
        attempt: retryAttempt,
        discount: '45.00',
        ...overrides,
      };
      return client.query(
        `INSERT INTO "CouponReservation" (id,"couponId","bookingId","studentUserId","paymentAttemptId","discountAmount","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [input.id, input.coupon, input.booking, input.student, input.attempt, input.discount, NOW],
      );
    }
    async function retryEvidence() {
      return (
        await pool.query(
          `SELECT
         (SELECT to_jsonb(r) FROM "CouponReservation" r WHERE id=$1) AS reservation,
         (SELECT to_jsonb(a) FROM "PaymentAttempt" a WHERE id=$2) AS attempt,
         (SELECT to_jsonb(b) FROM "Booking" b WHERE id=$3) AS booking,
         (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM "AuditLog" l WHERE "entityId"=$1) AS audit,
         (SELECT count(*)::int FROM "CouponUse" WHERE "bookingId"=$3) AS uses`,
          [retryId, retryAttempt, retryBooking],
        )
      ).rows[0];
    }
    assert.equal((await retryReservation()).rowCount, 1);
    await transaction(async (client) => {
      await client.query(`UPDATE "PaymentAttempt" SET status='FAILED' WHERE id=$1`, [retryAttempt]);
      await client.query(
        `UPDATE "CouponReservation" SET status='RELEASED',"releasedAt"=$2 WHERE id=$1`,
        [retryId, NOW],
      );
    });
    assert.equal((await retryReservation()).rowCount, 0);
    await pool.query(
      `UPDATE "Booking" SET "subtotalAmount"=500,"discountAmount"=50,"netAmount"=450 WHERE id=$1`,
      [retryBooking],
    );
    await rejected(() => retryReservation());
    process.stdout.write(
      'Reproduced original DB03 rejection of a canonical released retry after repricing.\n',
    );

    const beforeCorrection = await retryEvidence();
    await pool.query(await readFile(new URL(`${RETRY_MIGRATION}/migration.sql`, root), 'utf8'));
    assert.deepEqual(await retryEvidence(), beforeCorrection);
    assert.equal((await retryReservation()).rowCount, 0);
    assert.deepEqual(await retryEvidence(), beforeCorrection);

    const replacementCoupon = await coupon(20);
    await apply(retryBooking, replacementCoupon);
    const afterReplacement = await retryEvidence();
    assert.equal((await retryReservation()).rowCount, 0);
    const concurrentRetries = await Promise.all([retryReservation(), retryReservation()]);
    assert.deepEqual(
      concurrentRetries.map((result) => result.rowCount),
      [0, 0],
    );
    assert.deepEqual(await retryEvidence(), afterReplacement);
    assert.equal(afterReplacement.reservation.status, 'RELEASED');
    assert.equal(afterReplacement.attempt.status, 'FAILED');
    assert.equal(afterReplacement.attempt.amount, 405);
    assert.equal(afterReplacement.uses, 0);
    assert.equal(afterReplacement.audit.length, 2);

    // Same ID never authorizes changed immutable input; a fresh ID still checks current pricing.
    for (const overrides of [
      { discount: '44.00' },
      { coupon: replacementCoupon.id },
      { booking: unsupported },
      { student: tutor },
      { attempt: randomUUID() },
    ]) {
      await rejected(() => retryReservation(overrides));
    }
    await rejected(() => retryReservation({ id: randomUUID() }));
    await rejected(() =>
      retryReservation({ id: randomUUID(), coupon: replacementCoupon.id, discount: '100.00' }),
    );
    assert.deepEqual(await retryEvidence(), afterReplacement);
    const replacementAttempt = await attempt(retryBooking);
    const freshReservation = randomUUID();
    assert.equal(
      (
        await retryReservation({
          id: freshReservation,
          coupon: replacementCoupon.id,
          attempt: replacementAttempt,
          discount: '100.00',
        })
      ).rowCount,
      1,
    );
    assert.equal(
      (await pool.query(`SELECT status FROM "CouponReservation" WHERE id=$1`, [freshReservation]))
        .rows[0].status,
      'RESERVED',
    );
    // A historical retry also cannot duplicate the current reservation or its audit event.
    const withFreshReservation = await retryEvidence();
    assert.equal((await retryReservation()).rowCount, 0);
    assert.deepEqual(await retryEvidence(), withFreshReservation);
    process.stdout.write(
      'Forward correction: released retries survive repricing/coupon replacement, concurrent replays are no-ops, mismatched identities and stale new claims fail.\n',
    );

    const raced = await booking();
    const first = await pool.connect();
    const second = await pool.connect();
    let pending;
    try {
      await first.query('BEGIN');
      await first.query(`UPDATE "Booking" SET "paymentPending"=true WHERE id=$1`, [raced]);
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending = second
        .query(`UPDATE "Booking" SET "subtotalAmount"=500,"netAmount"=500 WHERE id=$1`, [raced])
        .then(
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
      await attempt(raced, first);
      await first.query('COMMIT');
      await rejected(async () => {
        throw await pending;
      });
    } finally {
      await first.query('ROLLBACK');
      await pending;
      first.release();
      second.release();
    }
    process.stdout.write(
      'Concurrent amount mutation waited for the payment claim and was rejected after commit.\n',
    );
  } finally {
    await pool.end();
  }
}

await main();

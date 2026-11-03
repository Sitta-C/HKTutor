import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { DatabaseError, Pool } = pg;
const CREATED_AT = '2030-01-01T00:00:00.000Z';

// Never read .env or allow connection options to redirect the disposable target.
export function disposableDatabaseUrl(environment = process.env) {
  assert.equal(environment.HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY, '1', 'Disposable opt-in required');
  assert.ok(environment.DATABASE_URL, 'Explicit DATABASE_URL required');
  const url = new URL(environment.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Loopback required');
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[-_].*[-_]test$/);
  assert.equal(url.search, '', 'URL options are refused');
  assert.equal(url.hash, '', 'URL fragments are refused');
  return environment.DATABASE_URL;
}

async function expectDatabaseError(operation, code, constraint) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof DatabaseError);
    assert.equal(error.code, code);
    if (constraint) {
      assert.equal(error.constraint, constraint);
    }
    return true;
  });
}

async function main() {
  const pool = new Pool({
    connectionString: disposableDatabaseUrl(),
    max: 3,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  const users = Array.from({ length: 4 }, () => randomUUID());
  const subject = randomUUID();
  const grade = randomUUID();
  const listing = randomUUID();
  const slots = [];
  const bookings = [];

  async function booking(status = 'completed') {
    const slotId = randomUUID();
    const id = randomUUID();
    slots.push(slotId);
    bookings.push(id);
    const start = new Date(Date.UTC(2030, 0, 2 + slots.length, 10));
    await pool.query(
      `INSERT INTO "AvailabilitySlot" ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
       VALUES ($1, $2, $3, $4)`,
      [slotId, users[1], start, new Date(start.getTime() + 3600000)],
    );
    await pool.query(
      `INSERT INTO "Booking" ("id", "studentUserId", "tutorProfileId", "listingId", "slotId",
       "status", "subtotalAmount", "netAmount", "updatedAt", "canceledById", "cancellationReason", "canceledAt")
       VALUES ($1, $2, $3, $4, $5, $6, 100, 100, $7, $8, $9, $10)`,
      [
        id,
        users[0],
        users[1],
        listing,
        slotId,
        status,
        CREATED_AT,
        status === 'canceled' ? users[0] : null,
        status === 'canceled' ? 'Synthetic cancellation' : null,
        status === 'canceled' ? CREATED_AT : null,
      ],
    );
    return id;
  }

  async function insert(client, bookingId, overrides = {}) {
    const row = {
      id: randomUUID(),
      bookingId,
      authorStudentUserId: users[0],
      tutorProfileId: users[1],
      clarity: 5,
      punctuality: 4,
      preparation: 5,
      feedback: 'Clear examples / อธิบายชัดเจน',
      createdAt: CREATED_AT,
      ...overrides,
    };
    return client.query(
      `INSERT INTO "Review" ("id", "bookingId", "authorStudentUserId", "tutorProfileId",
       "clarity", "punctuality", "preparation", "feedback", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        row.id,
        row.bookingId,
        row.authorStudentUserId,
        row.tutorProfileId,
        row.clarity,
        row.punctuality,
        row.preparation,
        row.feedback,
        row.createdAt,
      ],
    );
  }

  async function waitForLock(pid) {
    const deadline = Date.now() + 5000;
    while (true) {
      const result = await pool.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [
        pid,
      ]);
      if (result.rows[0].blocked) {
        return;
      }
      assert.ok(Date.now() < deadline, 'Competing write must block on the open transaction');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  // Start the contender while the owner holds its write, prove blocking, then commit the owner.
  async function contend(ownerWrite, contenderWrite, code, constraint, repeatableRead = false) {
    const first = await pool.connect();
    const second = await pool.connect();
    let pending;
    try {
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await first.query('BEGIN');
      if (repeatableRead) {
        await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        await second.query('SELECT id FROM "Booking"');
      }
      await ownerWrite(first);
      // Attach rejection handling before releasing the owner so no failure goes unhandled.
      pending = contenderWrite(second).then(
        () => ({ error: null }),
        (error) => ({ error }),
      );
      await waitForLock(pid);
      await first.query('COMMIT');
      const { error } = await pending;
      await expectDatabaseError(() => Promise.reject(error), code, constraint);
    } finally {
      await first.query('ROLLBACK');
      await pending;
      await second.query('ROLLBACK');
      first.release();
      second.release();
    }
  }

  try {
    const entries = await readdir(new URL('../prisma/migrations/', import.meta.url), {
      withFileTypes: true,
    });
    const applied = await pool.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      assert.ok(
        applied.rows.some((row) => row.migration_name === entry.name),
        `Migration missing: ${entry.name}`,
      );
    }
    const security = await pool.query(
      `SELECT relrowsecurity, EXISTS (SELECT 1 FROM aclexplode(relacl) WHERE grantee = 0) AS public_access
       FROM pg_class WHERE oid = '"Review"'::regclass`,
    );
    assert.equal(security.rows[0].relrowsecurity, true);
    assert.equal(security.rows[0].public_access, false);
    const browserAccess = await pool.query(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
       AND (has_table_privilege(rolname, '"Review"', 'SELECT, INSERT, UPDATE, DELETE'))`,
    );
    assert.equal(browserAccess.rowCount, 0);
    const indexes = await pool.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Review' AND schemaname = current_schema()`,
    );
    for (const name of [
      'Review_bookingId_key',
      'Review_authorStudentUserId_idx',
      'Review_tutorProfileId_createdAt_id_idx',
    ]) {
      assert.ok(
        indexes.rows.some((row) => row.indexname === name),
        `Missing ${name}`,
      );
    }
    assert.match(
      indexes.rows.find((row) => row.indexname === 'Review_tutorProfileId_createdAt_id_idx')
        .indexdef,
      /"createdAt" DESC, id DESC/,
    );
    for (const [index, id] of users.entries()) {
      await pool.query(
        'INSERT INTO "User" ("id", "email", "role", "updatedAt") VALUES ($1, $2, $3, $4)',
        [id, `review-${id}@example.test`, index % 2 === 0 ? 'student' : 'tutor', CREATED_AT],
      );
      if (index % 2 === 1) {
        await pool.query(
          `INSERT INTO "TutorProfile" ("userId", "displayName", "bio", "experienceYears", "updatedAt") VALUES ($1, 'Review synthetic tutor', 'Test', 1, $2)`,
          [id, CREATED_AT],
        );
      }
    }
    await pool.query(
      'INSERT INTO "Subject" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, $2)',
      [subject, CREATED_AT],
    );
    await pool.query(
      'INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, 1, $2)',
      [grade, CREATED_AT],
    );
    await pool.query(
      `INSERT INTO "TeachingListing" ("id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description", "updatedAt") VALUES ($1, $2, $3, $4, 100, 'Review synthetic listing', $5)`,
      [listing, users[1], subject, grade, CREATED_AT],
    );

    const primary = await booking();
    for (const field of ['clarity', 'punctuality', 'preparation']) {
      for (const value of [0, 6, -1]) {
        await expectDatabaseError(
          () => insert(pool, primary, { [field]: value }),
          '23514',
          `Review_${field}_check`,
        );
      }
      await expectDatabaseError(() => insert(pool, primary, { [field]: '1.5' }), '22P02');
      await expectDatabaseError(() => insert(pool, primary, { [field]: null }), '23502');
    }
    const whitespace =
      '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
    for (const feedback of [
      '',
      whitespace,
      'x'.repeat(1001),
      '😀'.repeat(1001),
      'ก'.repeat(1001),
      ...Array.from(whitespace).flatMap((space) => [`${space}x`, `x${space}`]),
    ]) {
      await expectDatabaseError(
        () => insert(pool, primary, { feedback }),
        '23514',
        'Review_feedback_check',
      );
    }
    for (const status of ['pending', 'confirmed', 'canceled', 'expired']) {
      const ineligible = await booking(status);
      await expectDatabaseError(
        () => insert(pool, ineligible),
        '23503',
        'Review_booking_evidence_fkey',
      );
    }
    for (const [overrides, code, constraint] of [
      [{ authorStudentUserId: users[2] }, '23503', 'Review_booking_evidence_fkey'],
      [{ tutorProfileId: users[3] }, '23503', 'Review_booking_evidence_fkey'],
      [{ bookingId: randomUUID() }, '23503', 'Review_booking_evidence_fkey'],
      [{ authorStudentUserId: randomUUID() }, '23503', 'Review_booking_evidence_fkey'],
      [{ tutorProfileId: randomUUID() }, '23503', 'Review_booking_evidence_fkey'],
    ]) {
      await expectDatabaseError(() => insert(pool, primary, overrides), code, constraint);
    }
    const review = (
      await insert(pool, primary, {
        clarity: 1,
        punctuality: 5,
        preparation: 1,
        feedback: '😀'.repeat(1000),
      })
    ).rows[0];
    assert.equal(Array.from(review.feedback).length, 1000);
    assert.equal(review.createdAt.toISOString(), CREATED_AT);
    for (const feedback of [
      'ก'.repeat(1000),
      'a',
      'a\n\tb',
      'e\u0301',
      '<b>literal plain text</b>',
    ]) {
      await pool.query('UPDATE "Review" SET "feedback" = $2 WHERE "id" = $1', [
        review.id,
        feedback,
      ]);
    }
    for (const [sql, parameters, constraint] of [
      [
        'UPDATE "Review" SET "authorStudentUserId" = $2 WHERE "id" = $1',
        [review.id, users[2]],
        'Review_booking_evidence_fkey',
      ],
      [
        'UPDATE "Review" SET "tutorProfileId" = $2 WHERE "id" = $1',
        [review.id, users[3]],
        'Review_booking_evidence_fkey',
      ],
      [
        'UPDATE "Review" SET "bookingId" = $2 WHERE "id" = $1',
        [review.id, bookings[1]],
        'Review_booking_evidence_fkey',
      ],
      [
        'UPDATE "Review" SET "bookingStatus" = \'pending\' WHERE "id" = $1',
        [review.id],
        'Review_completed_booking_check',
      ],
      ['UPDATE "Review" SET "clarity" = 0 WHERE "id" = $1', [review.id], 'Review_clarity_check'],
      [
        'UPDATE "Review" SET "feedback" = \' \' WHERE "id" = $1',
        [review.id],
        'Review_feedback_check',
      ],
      [
        'UPDATE "Booking" SET "status" = \'confirmed\' WHERE "id" = $1',
        [primary],
        'Review_booking_evidence_fkey',
      ],
      [
        'UPDATE "Booking" SET "studentUserId" = $2 WHERE "id" = $1',
        [primary, users[2]],
        'Review_booking_evidence_fkey',
      ],
      [
        'UPDATE "Booking" SET "tutorProfileId" = $2 WHERE "id" = $1',
        [primary, users[3]],
        'Review_booking_evidence_fkey',
      ],
    ]) {
      await expectDatabaseError(
        () => pool.query(sql, parameters),
        constraint.endsWith('_fkey') ? '23503' : '23514',
        constraint,
      );
    }
    await expectDatabaseError(
      () => pool.query('DELETE FROM "Booking" WHERE "id" = $1', [primary]),
      '23503',
      'Review_booking_evidence_fkey',
    );
    await expectDatabaseError(
      () => pool.query('DELETE FROM "User" WHERE "id" = $1', [users[0]]),
      '23503',
    );
    await expectDatabaseError(
      () => pool.query('DELETE FROM "TutorProfile" WHERE "userId" = $1', [users[1]]),
      '23503',
    );

    const raced = await booking();
    await contend(
      (client) => insert(client, raced),
      (client) => insert(client, raced),
      '23505',
      'Review_bookingId_key',
    );
    assert.equal(
      (await pool.query('SELECT id FROM "Review" WHERE "bookingId" = $1', [raced])).rowCount,
      1,
    );
    const reviewFirst = await booking();
    await contend(
      (client) => insert(client, reviewFirst),
      (client) =>
        client.query('UPDATE "Booking" SET "status" = \'confirmed\' WHERE "id" = $1', [
          reviewFirst,
        ]),
      '23503',
      'Review_booking_evidence_fkey',
    );
    const repeatable = await booking();
    await contend(
      (client) => insert(client, repeatable),
      (client) =>
        client.query('UPDATE "Booking" SET "status" = \'confirmed\' WHERE "id" = $1', [repeatable]),
      '23503',
      'Review_booking_evidence_fkey',
      true,
    );
    const bookingFirst = await booking();
    await contend(
      (client) =>
        client.query('UPDATE "Booking" SET "status" = \'confirmed\' WHERE "id" = $1', [
          bookingFirst,
        ]),
      (client) => insert(client, bookingFirst),
      '23503',
      'Review_booking_evidence_fkey',
    );
    const identityFirst = await booking();
    await contend(
      (client) =>
        client.query('UPDATE "Booking" SET "studentUserId" = $2 WHERE "id" = $1', [
          identityFirst,
          users[2],
        ]),
      (client) => insert(client, identityFirst),
      '23503',
      'Review_booking_evidence_fkey',
    );

    // Demonstrate the transaction boundary required of S3-T13/T17, not a shipped aggregate service.
    const cacheBefore = (
      await pool.query(
        'SELECT "ratingAverage", "reviewCount", "ratingUpdatedAt" FROM "TutorProfile" WHERE "userId" = $1',
        [users[1]],
      )
    ).rows[0];
    const rollbackBooking = await booking();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insert(client, rollbackBooking);
      await client.query(
        `UPDATE "TutorProfile" SET "ratingAverage" = aggregate.average, "reviewCount" = aggregate.count,
         "ratingUpdatedAt" = CURRENT_TIMESTAMP FROM (
           SELECT ROUND(SUM("clarity" + "punctuality" + "preparation")::numeric / (3 * COUNT(*)), 2) AS average,
           COUNT(*)::integer AS count FROM "Review" WHERE "tutorProfileId" = $1
         ) AS aggregate WHERE "userId" = $1`,
        [users[1]],
      );
      assert.equal(
        (
          await client.query('SELECT "reviewCount" FROM "TutorProfile" WHERE "userId" = $1', [
            users[1],
          ])
        ).rows[0].reviewCount,
        5,
      );
      await expectDatabaseError(
        () => insert(client, rollbackBooking),
        '23505',
        'Review_bookingId_key',
      );
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    assert.equal(
      (await pool.query('SELECT id FROM "Review" WHERE "bookingId" = $1', [rollbackBooking]))
        .rowCount,
      0,
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT "ratingAverage", "reviewCount", "ratingUpdatedAt" FROM "TutorProfile" WHERE "userId" = $1',
          [users[1]],
        )
      ).rows[0],
      cacheBefore,
    );
    const precision = await pool.query(
      `SELECT ROUND(SUM(clarity + punctuality + preparation)::numeric / (3 * COUNT(*)), 2)::text AS rating FROM (VALUES (5, 4, 5), (4, 4, 4)) AS dimensions(clarity, punctuality, preparation)`,
    );
    assert.equal(precision.rows[0].rating, '4.33');

    // Tied createdAt values exercise the descending id cursor, not insertion order.
    const listed = await pool.query(
      'SELECT "id", "createdAt" FROM "Review" WHERE "tutorProfileId" = $1 ORDER BY "createdAt" DESC, "id" DESC',
      [users[1]],
    );
    const page = await pool.query(
      'SELECT "id" FROM "Review" WHERE "tutorProfileId" = $1 AND ("createdAt", "id") < ($2, $3) ORDER BY "createdAt" DESC, "id" DESC',
      [users[1], listed.rows[0].createdAt, listed.rows[0].id],
    );
    assert.deepEqual(
      page.rows.map((row) => row.id),
      listed.rows.slice(1).map((row) => row.id),
    );
    assert.equal(
      (await pool.query('SELECT id FROM "Review" WHERE "tutorProfileId" = $1', [users[3]]))
        .rowCount,
      0,
    );
    process.stdout.write(
      'S3-DB01 direct constraints, Unicode, identity/status races, unique review, cursor and aggregate rollback checks passed.\n',
    );
  } finally {
    try {
      await pool.query('DELETE FROM "Review" WHERE "bookingId" = ANY($1::uuid[])', [bookings]);
      await pool.query('DELETE FROM "Booking" WHERE "id" = ANY($1::uuid[])', [bookings]);
      await pool.query('DELETE FROM "AvailabilitySlot" WHERE "id" = ANY($1::uuid[])', [slots]);
      await pool.query('DELETE FROM "TeachingListing" WHERE "id" = $1', [listing]);
      await pool.query('DELETE FROM "TutorProfile" WHERE "userId" = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM "Subject" WHERE "id" = $1', [subject]);
      await pool.query('DELETE FROM "GradeLevel" WHERE "id" = $1', [grade]);
    } finally {
      await pool.end();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

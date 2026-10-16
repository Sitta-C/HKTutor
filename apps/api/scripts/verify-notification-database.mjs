import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { DatabaseError, Pool } = pg;
const CREATED_AT = '2030-01-01T00:00:00.000Z';
const READ_AT = '2030-01-01T01:00:00.000Z';

// Never load .env or accept URL options that could redirect the disposable target.
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
    assert.equal(error.constraint, constraint);
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
  const users = [randomUUID(), randomUUID()];
  const booking = randomUUID();
  const slot = randomUUID();
  const listing = randomUUID();
  const subject = randomUUID();
  const grade = randomUUID();
  const eventKey = `booking-created:${booking}`;

  async function insertNotification(client, overrides = {}, onConflict = false) {
    const row = {
      id: randomUUID(),
      userId: users[0],
      eventKey,
      eventType: 'booking-created',
      bookingId: booking,
      title: 'New booking / การจองใหม่',
      body: 'Open the booking for details.',
      readAt: null,
      ...overrides,
    };
    return client.query(
      `INSERT INTO "Notification"
       ("id", "userId", "eventKey", "eventType", "bookingId", "title", "body", "readAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ${onConflict ? 'ON CONFLICT ("userId", "eventKey") DO NOTHING' : ''}
       RETURNING *`,
      [
        row.id,
        row.userId,
        row.eventKey,
        row.eventType,
        row.bookingId,
        row.title,
        row.body,
        row.readAt,
        CREATED_AT,
      ],
    );
  }

  try {
    const preflight = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()
       AND tablename = 'Notification'`,
    );
    for (const index of [
      'Notification_userId_eventKey_key',
      'Notification_userId_createdAt_id_idx',
      'Notification_userId_readAt_createdAt_id_idx',
      'Notification_bookingId_idx',
    ]) {
      assert.ok(
        preflight.rows.some((row) => row.indexname === index),
        `Missing index ${index}`,
      );
    }
    const security = await pool.query(
      `SELECT relrowsecurity,
         EXISTS (SELECT 1 FROM aclexplode(relacl) WHERE grantee = 0) AS public_access
       FROM pg_class WHERE oid = '"Notification"'::regclass`,
    );
    assert.equal(security.rows[0].relrowsecurity, true);
    assert.equal(security.rows[0].public_access, false);
    const browserAccess = await pool.query(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
       AND (has_table_privilege(rolname, '"Notification"', 'SELECT')
         OR has_table_privilege(rolname, '"Notification"', 'INSERT')
         OR has_table_privilege(rolname, '"Notification"', 'UPDATE')
         OR has_table_privilege(rolname, '"Notification"', 'DELETE'))`,
    );
    assert.equal(browserAccess.rowCount, 0, 'Browser roles must not access notifications directly');
    for (const [index, id] of users.entries()) {
      await pool.query(
        'INSERT INTO "User" ("id", "email", "role", "updatedAt") VALUES ($1, $2, $3, $4)',
        [id, `db05-${id}@example.test`, index === 0 ? 'student' : 'tutor', CREATED_AT],
      );
    }
    await pool.query(
      `INSERT INTO "TutorProfile" ("userId", "displayName", "bio", "experienceYears", "updatedAt")
       VALUES ($1, 'DB05 synthetic tutor', 'Test', 1, $2)`,
      [users[1], CREATED_AT],
    );
    await pool.query(
      'INSERT INTO "Subject" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, $2)',
      [subject, CREATED_AT],
    );
    await pool.query(
      'INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, 1, $2)',
      [grade, CREATED_AT],
    );
    await pool.query(
      `INSERT INTO "TeachingListing" ("id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description", "updatedAt")
       VALUES ($1, $2, $3, $4, 100, 'DB05 synthetic listing', $5)`,
      [listing, users[1], subject, grade, CREATED_AT],
    );
    await pool.query(
      `INSERT INTO "AvailabilitySlot" ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
       VALUES ($1, $2, '2030-01-02T10:00:00Z', '2030-01-02T11:00:00Z')`,
      [slot, users[1]],
    );
    await pool.query(
      `INSERT INTO "Booking" ("id", "studentUserId", "tutorProfileId", "listingId", "slotId", "subtotalAmount", "netAmount", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 100, 100, $6)`,
      [booking, users[0], users[1], listing, slot, CREATED_AT],
    );

    // Hold the first insert uncommitted while a second connection attempts the same key.
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await first.query('BEGIN');
      await insertNotification(first);
      const duplicate = expectDatabaseError(
        () => insertNotification(second),
        '23505',
        'Notification_userId_eventKey_key',
      );
      const deadline = Date.now() + 5000;
      while (true) {
        // The writer transaction stays open; avoid reusing its first activity snapshot.
        await first.query('SELECT pg_stat_clear_snapshot()');
        const waiting = await first.query(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
          [secondPid],
        );
        if (waiting.rows[0]?.wait_event_type === 'Lock') {
          break;
        }
        assert.ok(
          Date.now() < deadline,
          'Duplicate insert must contend with the uncommitted write',
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await first.query('COMMIT');
      await duplicate;
    } finally {
      await first.query('ROLLBACK');
      first.release();
      second.release();
    }
    assert.equal((await insertNotification(pool, {}, true)).rowCount, 0);
    const anotherRecipient = await insertNotification(pool, { userId: users[1] });
    assert.equal(anotherRecipient.rowCount, 1, 'Event keys are scoped to each recipient');
    const anotherEvent = await insertNotification(pool, { eventKey: `${eventKey}:reminder` });
    assert.equal(anotherEvent.rowCount, 1);
    const noBooking = await insertNotification(pool, {
      eventKey: `general:${booking}`,
      bookingId: null,
    });
    assert.equal(noBooking.rows[0].bookingId, null);
    assert.equal(noBooking.rows[0].readAt, null);
    assert.equal(noBooking.rows[0].createdAt.toISOString(), CREATED_AT);

    for (const [override, code, constraint] of [
      [{ userId: randomUUID() }, '23503', 'Notification_userId_fkey'],
      [{ bookingId: randomUUID(), eventKey: randomUUID() }, '23503', 'Notification_bookingId_fkey'],
      [{ eventKey: '' }, '23514', 'Notification_event_key_check'],
      [{ eventKey: ' padded ' }, '23514', 'Notification_event_key_check'],
      [{ eventKey: '\n\t' }, '23514', 'Notification_event_key_check'],
      [{ eventType: '' }, '23514', 'Notification_event_type_check'],
      [{ title: ' \n\t' }, '23514', 'Notification_title_check'],
      [{ body: '' }, '23514', 'Notification_body_check'],
      [{ readAt: '2029-12-31T23:59:59Z' }, '23514', 'Notification_read_time_check'],
    ]) {
      await expectDatabaseError(() => insertNotification(pool, override), code, constraint);
    }
    await expectDatabaseError(
      () => pool.query('DELETE FROM "Booking" WHERE "id" = $1', [booking]),
      '23503',
      'Notification_bookingId_fkey',
    );
    await pool.query(
      'UPDATE "Notification" SET "readAt" = $2 WHERE "id" = $1 AND "readAt" IS NULL',
      [noBooking.rows[0].id, READ_AT],
    );
    const retry = await insertNotification(
      pool,
      { eventKey: `general:${booking}`, title: 'Retried content', bookingId: null },
      true,
    );
    assert.equal(retry.rowCount, 0);
    const retained = await pool.query('SELECT * FROM "Notification" WHERE "id" = $1', [
      noBooking.rows[0].id,
    ]);
    assert.equal(retained.rows[0].title, noBooking.rows[0].title);
    assert.equal(retained.rows[0].readAt.toISOString(), READ_AT);
    const all = await pool.query(
      'SELECT * FROM "Notification" WHERE "userId" = $1 ORDER BY "createdAt" DESC, "id" DESC',
      [users[0]],
    );
    assert.equal(all.rowCount, 3);
    const unread = await pool.query(
      'SELECT * FROM "Notification" WHERE "userId" = $1 AND "readAt" IS NULL ORDER BY "createdAt" DESC, "id" DESC',
      [users[0]],
    );
    assert.equal(unread.rowCount, 2);
    const nextPage = await pool.query(
      `SELECT "id" FROM "Notification" WHERE "userId" = $1
       AND ("createdAt", "id") < ($2::timestamptz, $3::uuid)
       ORDER BY "createdAt" DESC, "id" DESC`,
      [users[0], all.rows[0].createdAt, all.rows[0].id],
    );
    assert.deepEqual(
      nextPage.rows.map((row) => row.id),
      all.rows.slice(1).map((row) => row.id),
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE "Booking" SET "status" = \'confirmed\' WHERE "id" = $1', [
        booking,
      ]);
      await insertNotification(client, { eventKey: `${eventKey}:rolled-back` });
      await expectDatabaseError(
        () => insertNotification(client),
        '23505',
        'Notification_userId_eventKey_key',
      );
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    assert.equal(
      (await pool.query('SELECT "status" FROM "Booking" WHERE "id" = $1', [booking])).rows[0]
        .status,
      'pending',
    );
    assert.equal(
      (
        await pool.query('SELECT "id" FROM "Notification" WHERE "userId" = ANY($1::uuid[])', [
          users,
        ])
      ).rowCount,
      4,
      'Failed writes and transaction rollback must leave no partial notification',
    );
    process.stdout.write(
      'S2-DB05 PostgreSQL constraints, retry/race, cursor and rollback checks passed.\n',
    );
  } finally {
    try {
      await pool.query('DELETE FROM "Notification" WHERE "userId" = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM "Booking" WHERE "id" = $1', [booking]);
      await pool.query('DELETE FROM "AvailabilitySlot" WHERE "id" = $1', [slot]);
      await pool.query('DELETE FROM "TeachingListing" WHERE "id" = $1', [listing]);
      await pool.query('DELETE FROM "TutorProfile" WHERE "userId" = $1', [users[1]]);
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

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { DatabaseError, Pool } = pg;
const REQUESTED_AT = '2030-01-01T00:00:00.000Z';
const DECIDED_AT = '2030-01-01T01:00:00.000Z';

// Never load .env: verification must not fall back to the shared project database.
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

export function readGate() {
  let arrivals = 0;
  let release;
  let reject;
  const ready = new Promise((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  void ready.catch(() => {});
  const timer = setTimeout(() => reject(new Error('Both transaction reads did not arrive')), 5000);
  return {
    async arrive() {
      arrivals += 1;
      if (arrivals === 2) {
        clearTimeout(timer);
        release();
      }
      await ready;
    },
    close() {
      clearTimeout(timer);
      release();
    },
  };
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
    max: 4,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  const student = randomUUID();
  const tutor = randomUUID();
  const otherTutor = randomUUID();
  const outsider = randomUUID();
  const subject = randomUUID();
  const grade = randomUUID();
  const listing = randomUUID();
  const bookings = [randomUUID(), randomUUID()];
  const slots = Array.from({ length: 5 }, () => randomUUID());
  const users = [student, tutor, otherTutor, outsider];

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function createRequest(
    bookingId,
    fromSlotId,
    requestedSlotId,
    requestedById = student,
    reason = 'ขอเลื่อนเวลา',
  ) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO "RescheduleRequest"
       ("id", "bookingId", "requestedById", "fromSlotId", "requestedSlotId", "reason", "requestedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, bookingId, requestedById, fromSlotId, requestedSlotId, reason, REQUESTED_AT],
    );
    return id;
  }

  async function closeRequest(id, status, reviewer = tutor) {
    if (status === 'withdrawn') {
      return pool.query(
        `UPDATE "RescheduleRequest" SET "status" = 'withdrawn', "withdrawnAt" = $2 WHERE "id" = $1`,
        [id, DECIDED_AT],
      );
    }
    return pool.query(
      `UPDATE "RescheduleRequest" SET "status" = $2, "reviewedById" = $3, "decidedAt" = $4 WHERE "id" = $1`,
      [id, status, reviewer, DECIDED_AT],
    );
  }

  async function snapshot() {
    const bookingRows = await pool.query(
      'SELECT * FROM "Booking" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"',
      [bookings],
    );
    const requestRows = await pool.query(
      'SELECT * FROM "RescheduleRequest" WHERE "bookingId" = ANY($1::uuid[]) ORDER BY "id"',
      [bookings],
    );
    const slotRows = await pool.query(
      'SELECT * FROM "AvailabilitySlot" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"',
      [slots],
    );
    return { bookings: bookingRows.rows, requests: requestRows.rows, slots: slotRows.rows };
  }

  // This is a database transaction probe for S2-T25's future implementation, not an API.
  async function approve(id, gate, failAfterSwap = false) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM "RescheduleRequest" WHERE "id" = $1 AND "status" = \'pending\'',
        [id],
      );
      assert.equal(rows.length, 1);
      const request = rows[0];
      await gate.arrive();
      await client.query('SELECT "id" FROM "Booking" WHERE "id" = $1 FOR UPDATE', [
        request.bookingId,
      ]);
      const closed = await client.query(
        `UPDATE "RescheduleRequest" SET "status" = 'approved', "reviewedById" = $2, "decidedAt" = $3
         WHERE "id" = $1 AND "status" = 'pending'`,
        [id, request.requestedById === student ? tutor : student, DECIDED_AT],
      );
      assert.equal(closed.rowCount, 1, 'Only a pending request can win');
      const swapped = await client.query(
        `UPDATE "Booking" SET "slotId" = $2
         WHERE "id" = $1 AND "slotId" = $3 AND "status" = 'confirmed'`,
        [request.bookingId, request.requestedSlotId, request.fromSlotId],
      );
      assert.equal(swapped.rowCount, 1);
      if (failAfterSwap) {
        // Fail after BOTH writes, inside PostgreSQL, to prove transaction rollback.
        await client.query(`UPDATE "Booking" SET "netAmount" = 99 WHERE "id" = $1`, [
          request.bookingId,
        ]);
      }
    });
  }

  try {
    const preflight = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema()
       AND indexname IN ('Booking_active_slot_key', 'RescheduleRequest_pending_booking_key')`,
    );
    assert.equal(preflight.rowCount, 2, 'Apply all committed migrations before verification');
    for (const [id, role] of [
      [student, 'student'],
      [tutor, 'tutor'],
      [otherTutor, 'tutor'],
      [outsider, 'admin'],
    ]) {
      await pool.query(
        `INSERT INTO "User" ("id", "email", "role", "updatedAt") VALUES ($1, $2, $3, $4)`,
        [id, `reschedule-${id}@example.test`, role, REQUESTED_AT],
      );
    }
    for (const id of [tutor, otherTutor]) {
      await pool.query(
        `INSERT INTO "TutorProfile" ("userId", "displayName", "bio", "experienceYears", "updatedAt")
         VALUES ($1, 'DB04 synthetic tutor', 'Test', 1, $2)`,
        [id, REQUESTED_AT],
      );
    }
    await pool.query(
      'INSERT INTO "Subject" ("id", "code", "name", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, $2)',
      [subject, REQUESTED_AT],
    );
    await pool.query(
      'INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "updatedAt") VALUES ($1::uuid, $1::text, $1::text, 1, $2)',
      [grade, REQUESTED_AT],
    );
    await pool.query(
      `INSERT INTO "TeachingListing" ("id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description", "updatedAt")
       VALUES ($1, $2, $3, $4, 100, 'DB04 synthetic listing', $5)`,
      [listing, tutor, subject, grade, REQUESTED_AT],
    );
    for (const [index, id] of slots.entries()) {
      await pool.query(
        `INSERT INTO "AvailabilitySlot" ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
         VALUES ($1, $2, $3, $4)`,
        [
          id,
          index === 4 ? otherTutor : tutor,
          `2030-01-0${index + 2}T10:00:00Z`,
          `2030-01-0${index + 2}T11:00:00Z`,
        ],
      );
    }
    for (const [index, id] of bookings.entries()) {
      await pool.query(
        `INSERT INTO "Booking" ("id", "studentUserId", "tutorProfileId", "listingId", "slotId", "status", "subtotalAmount", "netAmount", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'confirmed', 100, 100, $6)`,
        [id, student, tutor, listing, slots[index], REQUESTED_AT],
      );
    }
    const beforeRequests = await snapshot();
    for (const [from, target, requester, reason, constraint] of [
      [slots[0], slots[0], student, 'Reason', 'RescheduleRequest_distinct_slots_check'],
      [slots[1], slots[2], student, 'Reason', 'RescheduleRequest_initial_state_check'],
      [slots[0], slots[4], student, 'Reason', 'RescheduleRequest_same_tutor_check'],
      [slots[0], slots[2], outsider, 'Reason', 'RescheduleRequest_requester_participant_check'],
      [slots[0], slots[2], student, '', 'RescheduleRequest_reason_check'],
      [slots[0], slots[2], student, ' '.repeat(10), 'RescheduleRequest_reason_check'],
      [slots[0], slots[2], student, '\n\t', 'RescheduleRequest_reason_check'],
      [slots[0], slots[2], student, 'x'.repeat(501), 'RescheduleRequest_reason_check'],
    ]) {
      await expectDatabaseError(
        () => createRequest(bookings[0], from, target, requester, reason),
        '23514',
        constraint,
      );
    }
    assert.deepEqual(await snapshot(), beforeRequests);
    await pool.query('UPDATE "Booking" SET "status" = \'pending\' WHERE "id" = $1', [bookings[0]]);
    await expectDatabaseError(
      () => createRequest(bookings[0], slots[0], slots[2]),
      '23514',
      'RescheduleRequest_initial_state_check',
    );
    await pool.query('UPDATE "Booking" SET "status" = \'confirmed\' WHERE "id" = $1', [
      bookings[0],
    ]);
    await expectDatabaseError(
      () => createRequest(randomUUID(), slots[0], slots[2]),
      '23503',
      'RescheduleRequest_bookingId_fkey',
    );

    // Simultaneous inserts: exactly one pending row per booking, including tutor requests.
    const creates = await Promise.allSettled([
      createRequest(bookings[0], slots[0], slots[2], student, 'x'.repeat(500)),
      createRequest(bookings[0], slots[0], slots[2], tutor),
    ]);
    assert.equal(creates.filter((result) => result.status === 'fulfilled').length, 1);
    const lostCreate = creates.find((result) => result.status === 'rejected');
    assert.ok(lostCreate.reason instanceof DatabaseError);
    assert.equal(lostCreate.reason.code, '23505');
    assert.equal(lostCreate.reason.constraint, 'RescheduleRequest_pending_booking_key');
    const first = creates.find((result) => result.status === 'fulfilled').value;
    const firstRow = (
      await pool.query('SELECT "requestedById" FROM "RescheduleRequest" WHERE "id" = $1', [first])
    ).rows[0];
    const counterparty = firstRow.requestedById === student ? tutor : student;
    const beforeInvalidUpdates = await snapshot();
    for (const reviewer of [firstRow.requestedById, outsider]) {
      await expectDatabaseError(
        () => closeRequest(first, 'approved', reviewer),
        '23514',
        'RescheduleRequest_reviewer_counterparty_check',
      );
    }
    await expectDatabaseError(
      () =>
        pool.query('UPDATE "RescheduleRequest" SET "status" = \'approved\' WHERE "id" = $1', [
          first,
        ]),
      '23514',
      'RescheduleRequest_lifecycle_check',
    );
    await expectDatabaseError(
      () =>
        pool.query('UPDATE "RescheduleRequest" SET "requestedSlotId" = $2 WHERE "id" = $1', [
          first,
          slots[3],
        ]),
      '23514',
      'RescheduleRequest_identity_immutable_check',
    );
    await expectDatabaseError(
      () => pool.query('DELETE FROM "AvailabilitySlot" WHERE "id" = $1', [slots[2]]),
      '23503',
      'RescheduleRequest_requestedSlotId_fkey',
    );
    for (const update of [
      `"withdrawnAt" = '${DECIDED_AT}'`,
      `"status" = 'withdrawn'`,
      `"status" = 'withdrawn', "withdrawnAt" = '2029-12-31T23:59:59Z'`,
      `"status" = 'rejected', "reviewedById" = '${counterparty}', "decidedAt" = '2029-12-31T23:59:59Z'`,
      `"status" = 'rejected', "reviewedById" = '${counterparty}', "decidedAt" = '${DECIDED_AT}', "withdrawnAt" = '${DECIDED_AT}'`,
    ]) {
      await expectDatabaseError(
        () => pool.query(`UPDATE "RescheduleRequest" SET ${update} WHERE "id" = $1`, [first]),
        '23514',
        'RescheduleRequest_lifecycle_check',
      );
    }
    assert.deepEqual(await snapshot(), beforeInvalidUpdates);
    await closeRequest(first, 'rejected', counterparty);
    await expectDatabaseError(
      () => closeRequest(first, 'withdrawn'),
      '23514',
      'RescheduleRequest_terminal_check',
    );
    const withdrawn = await createRequest(bookings[0], slots[0], slots[2], tutor, 'x'.repeat(500));
    await closeRequest(withdrawn, 'withdrawn');
    assert.deepEqual((await snapshot()).bookings, beforeRequests.bookings);

    const requestA = await createRequest(bookings[0], slots[0], slots[2]);
    const requestB = await createRequest(bookings[1], slots[1], slots[2], tutor);
    assert.deepEqual(
      (await snapshot()).slots,
      beforeRequests.slots,
      'Pending does not reserve a target',
    );
    const gate = readGate();
    let race;
    try {
      race = await Promise.allSettled([approve(requestA, gate), approve(requestB, gate)]);
    } finally {
      gate.close();
    }
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    const conflict = race.find((result) => result.status === 'rejected');
    assert.ok(conflict.reason instanceof DatabaseError);
    assert.equal(conflict.reason.code, '23505');
    assert.equal(conflict.reason.constraint, 'Booking_active_slot_key');
    const afterRace = await snapshot();
    const winner = afterRace.requests.find((row) => row.status === 'approved');
    const loser = afterRace.requests.find((row) => row.status === 'pending');
    assert.ok(winner);
    assert.ok(loser);
    assert.equal(afterRace.bookings.find((row) => row.id === winner.bookingId).slotId, slots[2]);
    assert.deepEqual(
      afterRace.bookings.find((row) => row.id === loser.bookingId),
      beforeRequests.bookings.find((row) => row.id === loser.bookingId),
    );
    assert.equal(loser.decidedAt, null);
    assert.equal(loser.reviewedById, null);
    assert.deepEqual(afterRace.slots, beforeRequests.slots);
    // The winner's old slot is available immediately, while the loser's old slot stays reserved.
    const releasedSlotBooking = randomUUID();
    await pool.query(
      `INSERT INTO "Booking" ("id", "studentUserId", "tutorProfileId", "listingId", "slotId", "status", "subtotalAmount", "netAmount", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'confirmed', 100, 100, $6)`,
      [releasedSlotBooking, student, tutor, listing, winner.fromSlotId, REQUESTED_AT],
    );
    bookings.push(releasedSlotBooking);

    // Fail a swap to a free target after both writes and compare every persisted field.
    await closeRequest(loser.id, 'withdrawn');
    const rollbackRequest = await createRequest(loser.bookingId, loser.fromSlotId, slots[3]);
    await pool.query('UPDATE "AvailabilitySlot" SET "deletedAt" = $2 WHERE "id" = $1', [
      slots[3],
      REQUESTED_AT,
    ]);
    const beforeDeletedTarget = await snapshot();
    await expectDatabaseError(
      () => approve(rollbackRequest, { arrive: async () => {} }),
      '23514',
      'Booking_active_slot_not_deleted_check',
    );
    assert.deepEqual(await snapshot(), beforeDeletedTarget);
    await pool.query('UPDATE "AvailabilitySlot" SET "deletedAt" = NULL WHERE "id" = $1', [
      slots[3],
    ]);
    const beforeRollback = await snapshot();
    await expectDatabaseError(
      () => approve(rollbackRequest, { arrive: async () => {} }, true),
      '23514',
      'Booking_amount_balance_check',
    );
    assert.deepEqual(await snapshot(), beforeRollback);

    // Two decisions on the same request cannot both close it.
    const decisionGate = readGate();
    try {
      const decisions = await Promise.allSettled([
        approve(rollbackRequest, decisionGate),
        approve(rollbackRequest, decisionGate),
      ]);
      assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1);
      const decisionConflict = decisions.find((result) => result.status === 'rejected');
      assert.match(decisionConflict.reason.message, /Only a pending request can win/);
    } finally {
      decisionGate.close();
    }
    console.info(
      'S2-DB04 PostgreSQL constraints, pending/approval races, slot release and rollback passed.',
    );
  } finally {
    try {
      await pool.query('DELETE FROM "RescheduleRequest" WHERE "bookingId" = ANY($1::uuid[])', [
        bookings,
      ]);
      await pool.query('DELETE FROM "Booking" WHERE "listingId" = $1', [listing]);
      await pool.query('DELETE FROM "AvailabilitySlot" WHERE "id" = ANY($1::uuid[])', [slots]);
      await pool.query('DELETE FROM "TeachingListing" WHERE "id" = $1', [listing]);
      await pool.query('DELETE FROM "TutorProfile" WHERE "userId" = ANY($1::uuid[])', [
        [tutor, otherTutor],
      ]);
      await pool.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [users]);
      await pool.query('DELETE FROM "Subject" WHERE "id" = $1', [subject]);
      await pool.query('DELETE FROM "GradeLevel" WHERE "id" = $1', [grade]);
    } finally {
      await pool.end();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('S2-DB04 database verification failed; inspect the disposable database.', {
      code: error instanceof DatabaseError ? error.code : 'VERIFICATION_ASSERTION',
      constraint: error instanceof DatabaseError ? error.constraint : undefined,
    });
    process.exitCode = 1;
  });
}

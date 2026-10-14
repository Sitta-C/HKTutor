import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  disposableDatabaseUrl,
  readGate,
} from '../apps/api/scripts/verify-reschedule-request-database.mjs';

const migrationPath =
  'apps/api/prisma/migrations/20261014120000_add_reschedule_request/migration.sql';

function block(source, keyword, name) {
  const match = source.match(new RegExp(`${keyword} ${name}\\s*{([\\s\\S]*?)\\n}`));
  assert.ok(match, `${keyword} ${name} must exist`);
  return match[1];
}

test('S2-DB04 preserves the Data Model names, old/new slots and UTC lifecycle', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  const request = block(schema, 'model', 'RescheduleRequest');
  const status = block(schema, 'enum', 'RescheduleRequestStatus');
  for (const value of ['pending', 'approved', 'rejected', 'withdrawn']) {
    assert.match(status, new RegExp(`@map\\("${value}"\\)`));
  }
  assert.equal([...status.matchAll(/@map\(/g)].length, 4);
  for (const field of ['bookingId', 'requestedById', 'fromSlotId', 'requestedSlotId']) {
    assert.match(request, new RegExp(`${field}\\s+String\\s+@db\\.Uuid`));
  }
  assert.match(request, /reviewedById\s+String\?\s+@db\.Uuid/);
  assert.match(request, /status\s+RescheduleRequestStatus\s+@default\(PENDING\)/);
  for (const field of ['requestedAt', 'decidedAt', 'withdrawnAt']) {
    assert.match(request, new RegExp(`${field}\\s+DateTime\\??[^\\n]*@db\\.Timestamptz\\(3\\)`));
  }
  assert.match(block(schema, 'model', 'Booking'), /rescheduleRequests\s+RescheduleRequest\[\]/);
  for (const relation of ['RescheduleRequester', 'RescheduleReviewer']) {
    assert.match(block(schema, 'model', 'User'), new RegExp(`@relation\\("${relation}"\\)`));
  }
  for (const relation of ['RescheduleFromSlot', 'RescheduleRequestedSlot']) {
    assert.match(
      block(schema, 'model', 'AvailabilitySlot'),
      new RegExp(`@relation\\("${relation}"\\)`),
    );
  }
});

test('S2-DB04 adds forward constraints and indexes without reserving pending targets', async () => {
  const sql = await fs.readFile(migrationPath, 'utf8');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "RescheduleRequest_pending_booking_key"\s+ON "RescheduleRequest"\("bookingId"\) WHERE "status" = 'pending'/,
  );
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX[^;]+\("requestedSlotId"\)/);
  for (const fields of [
    '"bookingId", "status", "requestedAt", "id"',
    '"requestedById", "status", "requestedAt", "id"',
  ]) {
    assert.ok(sql.includes(`ON "RescheduleRequest"(${fields})`));
  }
  for (const [field, table] of [
    ['bookingId', 'Booking'],
    ['requestedById', 'User'],
    ['reviewedById', 'User'],
    ['fromSlotId', 'AvailabilitySlot'],
    ['requestedSlotId', 'AvailabilitySlot'],
  ]) {
    assert.ok(
      sql.includes(
        `FOREIGN KEY ("${field}") REFERENCES "${table}"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
      ),
    );
  }
  for (const name of ['distinct_slots', 'reason', 'lifecycle']) {
    assert.match(sql, new RegExp(`CONSTRAINT "RescheduleRequest_${name}_check" CHECK`));
  }
  assert.match(sql, /FOR UPDATE;/);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON "RescheduleRequest"/);
  for (const name of [
    'requester_participant',
    'reviewer_counterparty',
    'initial_state',
    'same_tutor',
    'identity_immutable',
    'terminal',
  ]) {
    assert.ok(sql.includes(`'RescheduleRequest_${name}_check'`));
  }
  assert.match(sql, /ALTER TABLE "RescheduleRequest" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE "RescheduleRequest" FROM PUBLIC/);
  assert.match(sql, /rolname IN \('anon', 'authenticated'\)/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)/i);
  assert.doesNotMatch(sql, /\b(DELETE FROM|INSERT INTO|UPDATE "Booking" SET)\b/i);
});

test('the database verifier refuses unapproved, omitted, remote or redirected targets', () => {
  const safe = 'postgresql://tester@127.0.0.1:55435/hktutor_reschedule_test';
  assert.throws(() => disposableDatabaseUrl({ DATABASE_URL: safe }));
  for (const value of [
    undefined,
    'invalid',
    'https://localhost/hktutor_reschedule_test',
    'postgresql://tester@database.example.test/hktutor_reschedule_test',
    'postgresql://tester@localhost/shared',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ]) {
    assert.throws(() =>
      disposableDatabaseUrl({ HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1', DATABASE_URL: value }),
    );
  }
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const url = `postgresql://tester@${host}:55435/hktutor_reschedule_test`;
    assert.equal(
      disposableDatabaseUrl({ HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1', DATABASE_URL: url }),
      url,
    );
  }
});

test('the race gate holds both reads and cleans up a waiting read', async () => {
  const gate = readGate();
  let released = false;
  const first = gate.arrive().then(() => {
    released = true;
  });
  await Promise.resolve();
  assert.equal(released, false);
  await gate.arrive();
  await first;
  assert.equal(released, true);
  gate.close();
  const abandoned = readGate();
  const waiting = abandoned.arrive();
  abandoned.close();
  await waiting;
});

test('the race gate times out instead of hanging when a transaction never arrives', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const gate = readGate();
  const waiting = assert.rejects(gate.arrive(), /Both transaction reads did not arrive/);
  context.mock.timers.tick(5001);
  await waiting;
  gate.close();
});

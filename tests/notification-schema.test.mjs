import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { disposableDatabaseUrl } from '../apps/api/scripts/verify-notification-database.mjs';

const migrationPath = 'apps/api/prisma/migrations/20261016130000_add_notification/migration.sql';

function model(source, name) {
  const match = source.match(new RegExp(`model ${name}\\s*{([\\s\\S]*?)\\n}`));
  assert.ok(match, `model ${name} must exist`);
  return match[1];
}

test('S2-DB05 defines minimal recipient metadata and optional relational booking link', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  const notification = model(schema, 'Notification');
  assert.match(notification, /id\s+String\s+@id @default\(uuid\(\)\) @db\.Uuid/);
  assert.match(notification, /userId\s+String\s+@db\.Uuid/);
  assert.match(notification, /bookingId\s+String\?\s+@db\.Uuid/);
  for (const field of ['eventKey', 'eventType', 'title', 'body']) {
    assert.match(notification, new RegExp(`\\n\\s*${field}\\s+String\\s*\\n`));
  }
  assert.match(notification, /readAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  assert.match(notification, /createdAt\s+DateTime\s+@default\(now\(\)\) @db\.Timestamptz\(3\)/);
  for (const [field, target, key] of [
    ['user', 'User', 'userId'],
    ['booking', 'Booking\\?', 'bookingId'],
  ]) {
    assert.match(
      notification,
      new RegExp(
        `${field}\\s+${target}\\s+@relation\\(fields: \\[${key}\\], references: \\[id\\], onDelete: Restrict, onUpdate: Cascade\\)`,
      ),
    );
  }
  for (const target of ['User', 'Booking']) {
    assert.match(model(schema, target), /notifications\s+Notification\[\]/);
  }
  assert.doesNotMatch(notification, /\b(Json|payloadJson|signedUrl|meetingUrl|token|secret)\b/);
});

test('S2-DB05 migrates recipient idempotency, both inbox indexes and private access atomically', async () => {
  const sql = await fs.readFile(migrationPath, 'utf8');
  const schema = model(await fs.readFile('apps/api/prisma/schema.prisma', 'utf8'), 'Notification');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /"readAt" TIMESTAMPTZ\(3\),/);
  assert.match(sql, /"createdAt" TIMESTAMPTZ\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  for (const [kind, fields, name] of [
    ['unique', ['userId', 'eventKey'], 'Notification_userId_eventKey_key'],
    ['index', ['userId', 'createdAt', 'id'], 'Notification_userId_createdAt_id_idx'],
    [
      'index',
      ['userId', 'readAt', 'createdAt', 'id'],
      'Notification_userId_readAt_createdAt_id_idx',
    ],
    ['index', ['bookingId'], 'Notification_bookingId_idx'],
  ]) {
    assert.ok(schema.includes(`@@${kind}([${fields.join(', ')}], map: "${name}")`));
    assert.ok(sql.includes(`CREATE ${kind === 'unique' ? 'UNIQUE ' : ''}INDEX "${name}"`));
    assert.ok(sql.includes(`ON "Notification"(${fields.map((field) => `"${field}"`).join(', ')})`));
  }
  for (const [key, target] of [
    ['userId', 'User'],
    ['bookingId', 'Booking'],
  ]) {
    assert.ok(
      sql.includes(
        `FOREIGN KEY ("${key}") REFERENCES "${target}"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
      ),
    );
  }
  for (const name of ['event_key', 'event_type', 'title', 'body', 'read_time']) {
    assert.ok(sql.includes(`CONSTRAINT "Notification_${name}_check" CHECK`));
  }
  assert.match(sql, /"readAt" IS NULL OR "readAt" >= "createdAt"/);
  assert.match(sql, /ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE "Notification" FROM PUBLIC/);
  assert.match(sql, /rolname IN \('anon', 'authenticated'\)/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)/i);
  assert.doesNotMatch(sql, /\b(INSERT INTO|DELETE FROM|UPDATE "Booking" SET)\b/i);
});

test('notification verifier refuses unapproved, remote, shared and redirected database targets', () => {
  const safe = 'postgresql://tester@127.0.0.1:55437/hktutor_notification_test';
  assert.throws(() => disposableDatabaseUrl({ DATABASE_URL: safe }));
  for (const url of [
    undefined,
    'invalid',
    'https://localhost/hktutor_notification_test',
    'postgresql://tester@database.example.test/hktutor_notification_test',
    'postgresql://tester@localhost/shared',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ]) {
    assert.throws(() =>
      disposableDatabaseUrl({ HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1', DATABASE_URL: url }),
    );
  }
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const url = `postgresql://tester@${host}:55437/hktutor_notification_test`;
    assert.equal(
      disposableDatabaseUrl({ HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1', DATABASE_URL: url }),
      url,
    );
  }
});

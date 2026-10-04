import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const schemaPath = 'apps/api/prisma/schema.prisma';
const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_add_conversation_message';

function readBlock(source, keyword, name) {
  const match = source.match(new RegExp(`${keyword} ${name}\\s*{([\\s\\S]*?)\\n}`));
  assert.ok(match, `${keyword} ${name} must exist`);
  return match[1];
}

async function readMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'S2-DB03 migration must exist exactly once');
  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('defines the S2-DB03 Conversation and Message Prisma boundary', async () => {
  const schema = await fs.readFile(schemaPath, 'utf8');
  const user = readBlock(schema, 'model', 'User');
  const conversation = readBlock(schema, 'model', 'Conversation');
  const message = readBlock(schema, 'model', 'Message');

  assert.match(
    user,
    /studentConversations\s+Conversation\[\]\s+@relation\("ConversationStudent"\)/,
  );
  assert.match(user, /tutorConversations\s+Conversation\[\]\s+@relation\("ConversationTutor"\)/);
  assert.match(user, /sentMessages\s+Message\[\]\s+@relation\("MessageSender"\)/);

  assert.match(conversation, /studentUserId\s+String\s+@db\.Uuid/);
  assert.match(conversation, /tutorUserId\s+String\s+@db\.Uuid/);
  assert.match(conversation, /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
  assert.match(
    conversation,
    /student\s+User\s+@relation\("ConversationStudent",\s*fields:\s*\[studentUserId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(
    conversation,
    /tutor\s+User\s+@relation\("ConversationTutor",\s*fields:\s*\[tutorUserId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(
    conversation,
    /@@unique\(\[studentUserId, tutorUserId\],\s*map:\s*"Conversation_studentUserId_tutorUserId_key"\)/,
  );

  for (const field of [
    'conversationId',
    'senderUserId',
    'text',
    'clientMessageId',
    'sentAt',
    'readAt',
  ]) {
    assert.match(message, new RegExp(`\\n\\s*${field}\\s+`));
  }

  assert.match(message, /sentAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
  assert.match(message, /readAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  assert.match(
    message,
    /@@unique\(\[senderUserId, clientMessageId\],\s*map:\s*"Message_senderUserId_clientMessageId_key"\)/,
  );
  assert.match(
    message,
    /@@index\(\[conversationId, id\],\s*map:\s*"Message_conversationId_id_idx"\)/,
  );
  assert.match(
    message,
    /@@index\(\[conversationId, sentAt, id\],\s*map:\s*"Message_conversationId_sentAt_id_idx"\)/,
  );
});

test('migrates participant, idempotency and cursor constraints', async () => {
  const sql = await readMigration();

  assert.match(sql, /CREATE TABLE "Conversation"/i);
  assert.match(sql, /CREATE TABLE "Message"/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "Conversation_studentUserId_tutorUserId_key"\s+ON "Conversation"\("studentUserId", "tutorUserId"\)/i,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "Message_senderUserId_clientMessageId_key"\s+ON "Message"\("senderUserId", "clientMessageId"\)/i,
  );
  assert.match(
    sql,
    /CREATE INDEX "Message_conversationId_id_idx"\s+ON "Message"\("conversationId", "id"\)/i,
  );
  assert.match(
    sql,
    /CREATE INDEX "Message_conversationId_sentAt_id_idx"\s+ON "Message"\("conversationId", "sentAt", "id"\)/i,
  );

  for (const [column, table] of [
    ['studentUserId', 'Conversation'],
    ['tutorUserId', 'Conversation'],
    ['senderUserId', 'Message'],
  ]) {
    assert.match(
      sql,
      new RegExp(
        `FOREIGN KEY \\("${column}"\\) REFERENCES "User"\\("id"\\)[\\s\\S]*?ON DELETE RESTRICT ON UPDATE CASCADE`,
        'i',
      ),
      `${table}.${column} must reference the canonical User row`,
    );
  }

  assert.match(
    sql,
    /FOREIGN KEY \("conversationId"\) REFERENCES "Conversation"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/i,
  );

  for (const constraint of [
    'Conversation_distinct_participants_check',
    'Message_text_check',
    'Message_client_message_id_check',
    'Message_read_time_check',
  ]) {
    assert.match(sql, new RegExp(`CONSTRAINT "${constraint}"\\s+CHECK`, 'i'));
  }
});

test('rejects invalid roles, participant drift and non-participant senders before persistence', async () => {
  const sql = await readMigration();

  assert.match(sql, /CREATE FUNCTION "validate_conversation_participants"\(\)/i);
  assert.match(sql, /student_role IS DISTINCT FROM 'student'/i);
  assert.match(sql, /tutor_role IS DISTINCT FROM 'tutor'/i);
  assert.match(sql, /Conversation participants are immutable/i);
  assert.match(
    sql,
    /CREATE TRIGGER "Conversation_validate_participants"\s+BEFORE INSERT OR UPDATE ON "Conversation"/i,
  );

  assert.match(sql, /CREATE FUNCTION "validate_message_sender"\(\)/i);
  assert.match(
    sql,
    /NEW\."senderUserId" <> conversation_student_user_id\s+AND NEW\."senderUserId" <> conversation_tutor_user_id/i,
  );
  assert.match(sql, /Message senderUserId must be a conversation participant/i);
  assert.match(sql, /Message identity fields are immutable/i);
  assert.match(
    sql,
    /CREATE TRIGGER "Message_validate_sender"\s+BEFORE INSERT OR UPDATE ON "Message"/i,
  );

  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)/i);
  assert.doesNotMatch(
    sql,
    /\b(INSERT\s+INTO|UPDATE\s+"(?:Conversation|Message)"|DELETE\s+FROM)\b/i,
  );
});

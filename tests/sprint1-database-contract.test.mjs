import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_align_sprint1_database_contract';

async function readAlignmentMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'Sprint 1 database alignment migration must exist once');

  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('aligns cached-email uniqueness with the non-deleted User contract', async () => {
  const sql = await readAlignmentMigration();
  const index = sql.match(
    /CREATE UNIQUE INDEX "User_active_primaryEmail_key"[\s\S]*?WHERE([\s\S]*?);/i,
  );

  assert.ok(index, 'the final cached-email index must retain its stable name');
  assert.match(index[1], /"primaryEmail" IS NOT NULL/i);
  assert.match(index[1], /"deletedAt" IS NULL/i);
  assert.doesNotMatch(index[1], /"accountStatus"/i);
  assert.match(sql, /HAVING COUNT\(\*\) > 1/i);
  assert.match(sql, /CONSTRAINT\s*=\s*'User_active_primaryEmail_key'/i);
});

test('rejects partial or blank local consent state at the database boundary', async () => {
  const sql = await readAlignmentMigration();

  assert.match(sql, /ADD CONSTRAINT "User_consent_policy_pair_check" CHECK/i);
  assert.match(sql, /"consentAcceptedAt" IS NULL AND "policyVersion" IS NULL/i);
  assert.match(sql, /"consentAcceptedAt" IS NOT NULL/i);
  assert.match(sql, /NULLIF\(BTRIM\("policyVersion"\), ''\) IS NOT NULL/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
});

test('keeps the executable database probe restricted to a disposable local database', async () => {
  const source = await fs.readFile('apps/api/scripts/verify-sprint1-database.mjs', 'utf8');

  assert.match(source, /HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY/);
  assert.match(source, /localhost/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /::1/);
  assert.match(source, /ROLLBACK/);
  assert.doesNotMatch(source, /SUPABASE|CLERK_SECRET|SERVICE_ROLE/i);
});

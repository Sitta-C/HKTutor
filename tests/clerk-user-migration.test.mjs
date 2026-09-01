import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_migrate_user_identity_to_clerk';

async function readClerkIdentityMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'Clerk identity migration must exist exactly once');

  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('guards the approved seed boundary before the identity purge', async () => {
  const sql = await readClerkIdentityMigration();
  const firstDelete = sql.indexOf('DELETE FROM "Booking"');
  const guard = sql.slice(0, firstDelete);

  assert.match(sql, /^BEGIN;/i);
  assert.match(sql, /LOCK TABLE[\s\S]*"Booking"[\s\S]*"User"[\s\S]*ACCESS EXCLUSIVE/i);
  assert.ok(sql.indexOf('RAISE EXCEPTION') < firstDelete);

  for (const invariant of [
    'student-user',
    'account-state',
    'consent-data',
    'booking-row',
    'availability-slot-row',
    'seed-shape',
  ]) {
    assert.match(guard, new RegExp(`S1-T07 Clerk migration rejected: ${invariant}`));
  }

  for (const id of [
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000006',
  ]) {
    assert.match(guard, new RegExp(id));
  }
});

test('rejects orphaned profile and listing relationships before the identity purge', async () => {
  const sql = await readClerkIdentityMigration();
  const firstDelete = sql.indexOf('DELETE FROM "Booking"');
  const guard = sql.slice(0, firstDelete);

  assert.match(
    guard,
    /FROM "TutorProfile" AS profile\s+LEFT JOIN "User" AS owner ON owner\."id" = profile\."userId"\s+WHERE owner\."id" IS NULL\s+OR owner\."role" <> 'tutor'/i,
  );
  assert.match(
    guard,
    /FROM "TeachingListing" AS listing\s+LEFT JOIN "TutorProfile" AS profile ON profile\."userId" = listing\."tutorProfileId"\s+LEFT JOIN "User" AS owner ON owner\."id" = profile\."userId"\s+WHERE profile\."userId" IS NULL\s+OR owner\."id" IS NULL\s+OR owner\."role" <> 'tutor'/i,
  );

  for (const [listingId, tutorProfileId] of [
    ['000000000002', '000000000001'],
    ['000000000003', '000000000002'],
    ['000000000004', '000000000003'],
    ['000000000005', '000000000004'],
  ]) {
    assert.match(
      guard,
      new RegExp(
        `listing\\."id" = '10000000-0000-4000-8000-${listingId}'::uuid AND listing\\."tutorProfileId" <> '20000000-0000-4000-8000-${tutorProfileId}'::uuid`,
      ),
    );
  }

  assert.match(
    guard,
    /listing\."id" = '10000000-0000-4000-8000-000000000006'::uuid[\s\S]*listing\."tutorProfileId" <> \(\s*SELECT "tutorProfileId"\s+FROM "TeachingListing"\s+WHERE "id" = '10000000-0000-4000-8000-000000000001'::uuid\s*\)/i,
  );
});

test('limits destructive SQL to the approved demo identity graph', async () => {
  const sql = await readClerkIdentityMigration();

  assert.deepEqual(
    [...sql.matchAll(/DELETE FROM "([^"]+)"/g)].map((match) => match[1]),
    ['Booking', 'AvailabilitySlot', 'TeachingListing', 'TutorProfile', 'User'],
  );
  assert.doesNotMatch(sql, /TRUNCATE|DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+"(?:Subject|GradeLevel)"/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
});

test('installs the stable Clerk database names and forward-only user columns', async () => {
  const sql = await readClerkIdentityMigration();

  assert.match(sql, /ALTER TABLE "User" RENAME COLUMN "email" TO "primaryEmail"/i);
  assert.match(sql, /ALTER COLUMN "primaryEmail" DROP NOT NULL/i);
  assert.match(sql, /DROP COLUMN "passwordHash"/i);
  assert.match(sql, /ADD COLUMN "clerkUserId" TEXT NOT NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX "User_clerkUserId_key"/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "User_active_primaryEmail_key"[\s\S]*WHERE[\s\S]*"primaryEmail" IS NOT NULL[\s\S]*"accountStatus" = 'active'[\s\S]*"deletedAt" IS NULL/i,
  );
  assert.match(sql, /CREATE TYPE "ClerkWebhookStatus" AS ENUM \('processed', 'failed'\)/i);
  assert.match(sql, /CREATE TABLE "ClerkWebhookEvent"/i);
  assert.match(sql, /CREATE INDEX "ClerkWebhookEvent_clerkUserId_idx"/i);
  assert.match(sql, /COMMIT;\s*$/i);
});

test('contains no deployment connection or real Clerk identity material', async () => {
  const sql = await readClerkIdentityMigration();

  assert.doesNotMatch(sql, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(sql, /\buser_[A-Za-z0-9]{20,}\b/);
});

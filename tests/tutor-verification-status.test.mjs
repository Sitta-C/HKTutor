import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('new tutor profiles default to UNVERIFIED while submitted documents remain PENDING', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  assert.match(schema, /UNVERIFIED\s+@map\("unverified"\)/);
  assert.match(schema, /verificationStatus\s+TutorVerificationStatus\s+@default\(UNVERIFIED\)/);
  assert.match(schema, /reviewStatus\s+TutorDocumentReviewStatus\s+@default\(PENDING\)/);
});

test('forward migrations add the enum before backfilling only pending profiles without documents', async () => {
  const root = 'apps/api/prisma/migrations';
  const addition = await fs.readFile(
    `${root}/20261012100000_add_unverified_tutor_status/migration.sql`,
    'utf8',
  );
  const backfill = await fs.readFile(
    `${root}/20261012100100_default_tutor_status_unverified/migration.sql`,
    'utf8',
  );
  assert.match(
    addition,
    /ALTER TYPE "TutorVerificationStatus" ADD VALUE 'unverified' BEFORE 'pending'/,
  );
  assert.doesNotMatch(addition, /BEGIN;|SET DEFAULT|UPDATE "TutorProfile"/);
  assert.match(backfill, /ALTER COLUMN "verificationStatus" SET DEFAULT 'unverified'/);
  assert.match(
    backfill,
    /WHERE tutor\."verificationStatus" = 'pending'::"TutorVerificationStatus"/,
  );
  assert.match(
    backfill,
    /AND NOT EXISTS \(\s*SELECT 1 FROM "TutorDocument" WHERE "tutorUserId" = tutor\."userId"\s*\)/,
  );
  assert.doesNotMatch(`${addition}\n${backfill}`, /DROP\s+|DELETE\s+FROM|UPDATE "TutorDocument"/i);
});

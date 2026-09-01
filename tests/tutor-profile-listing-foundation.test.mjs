import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_add_tutor_profile_listing_foundation';

async function readTutorProfileListingMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'S1-T14 migration must exist exactly once');

  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('defines the S1-T14 tutor profile and listing foundation', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');

  assert.match(
    schema,
    /enum TutorVerificationStatus\s*{[\s\S]*PENDING[\s\S]*VERIFIED[\s\S]*REJECTED/,
  );
  assert.match(
    schema,
    /enum ListingPublicationStatus\s*{[\s\S]*DRAFT[\s\S]*PUBLISHED[\s\S]*ARCHIVED/,
  );
  assert.match(schema, /model TutorProfile\s*{[\s\S]*userId\s+String\s+@id\s+@db\.Uuid/);
  assert.match(schema, /ratingAverage\s+Decimal\?\s+@db\.Decimal\(3,\s*2\)/);
  assert.match(schema, /model Subject\s*{[\s\S]*code\s+String\s+@unique\s+@db\.Citext/);
  assert.match(schema, /model GradeLevel\s*{[\s\S]*sortOrder\s+Int/);
  assert.match(
    schema,
    /model TeachingListing\s*{[\s\S]*pricePerHour\s+Decimal\s+@db\.Decimal\(10,\s*2\)/,
  );
  assert.match(schema, /tutorProfile\s+TutorProfile\?/);
  assert.doesNotMatch(schema, /model Review\s*{/);
});

test('adds a forward-only tutor profile and listing migration with database constraints', async () => {
  const sql = await readTutorProfileListingMigration();

  assert.match(sql, /CREATE TYPE "TutorVerificationStatus" AS ENUM/i);
  assert.match(sql, /CREATE TYPE "ListingPublicationStatus" AS ENUM/i);
  assert.match(sql, /CREATE TABLE "TutorProfile"/i);
  assert.match(sql, /CREATE TABLE "Subject"/i);
  assert.match(sql, /CREATE TABLE "GradeLevel"/i);
  assert.match(sql, /CREATE TABLE "TeachingListing"/i);
  assert.match(
    sql,
    /CREATE TABLE "Subject"[\s\S]*?"code"\s+extensions\.CITEXT\s+NOT NULL[\s\S]*?"name"\s+extensions\.CITEXT\s+NOT NULL/i,
  );
  assert.match(
    sql,
    /CREATE TABLE "GradeLevel"[\s\S]*?"code"\s+extensions\.CITEXT\s+NOT NULL[\s\S]*?"name"\s+extensions\.CITEXT\s+NOT NULL/i,
  );
  assert.match(sql, /TutorProfile_experienceYears_check/i);
  assert.match(sql, /TutorProfile_ratingAverage_check/i);
  assert.match(sql, /TutorProfile_reviewCount_check/i);
  assert.match(sql, /GradeLevel_sortOrder_check/i);
  assert.match(sql, /TeachingListing_pricePerHour_check/i);
  assert.match(sql, /TeachingListing_description_length_check/i);
  assert.match(sql, /TeachingListing_publishedAt_check/i);
  assert.match(
    sql,
    /"TeachingListing_search_idx"\s+ON\s+"TeachingListing"\s*\(\s*"publicationStatus",\s*"subjectId",\s*"gradeLevelId",\s*"pricePerHour"\s*\)/i,
  );
  assert.equal(
    [...sql.matchAll(/ON DELETE RESTRICT ON UPDATE CASCADE/gi)].length,
    4,
    'all four domain foreign keys must use restrictive deletes and cascading updates',
  );
  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN)/i);
  assert.doesNotMatch(sql, /CREATE TABLE "(AvailabilitySlot|Booking|Review)"/i);
});

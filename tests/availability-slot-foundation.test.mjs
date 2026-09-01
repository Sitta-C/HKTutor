import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const schemaPath = 'apps/api/prisma/schema.prisma';
const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_add_availability_slot_foundation';

function readModel(schema, modelName) {
  const match = schema.match(new RegExp(`model ${modelName}\\s*{([\\s\\S]*?)\\n}`));
  assert.ok(match, `${modelName} model must exist`);
  return match[1];
}

async function readAvailabilitySlotMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'S1-T17 migration must exist exactly once');

  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('defines the S1-T17 availability slot schema boundary', async () => {
  const schema = await fs.readFile(schemaPath, 'utf8');
  const tutorProfile = readModel(schema, 'TutorProfile');
  const slot = readModel(schema, 'AvailabilitySlot');

  assert.match(tutorProfile, /availabilitySlots\s+AvailabilitySlot\[\]/);
  assert.match(slot, /id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/);
  assert.match(slot, /tutorProfileId\s+String\s+@db\.Uuid/);
  assert.match(slot, /startAtUtc\s+DateTime\s+@db\.Timestamptz\(3\)/);
  assert.match(slot, /endAtUtc\s+DateTime\s+@db\.Timestamptz\(3\)/);
  assert.match(slot, /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
  assert.match(slot, /deletedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  assert.match(
    slot,
    /tutorProfile\s+TutorProfile\s+@relation\(fields:\s*\[tutorProfileId\],\s*references:\s*\[userId\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(
    slot,
    /@@index\(\[tutorProfileId,\s*startAtUtc\],\s*map:\s*"AvailabilitySlot_tutorProfileId_startAtUtc_idx"\)/,
  );
  assert.doesNotMatch(slot, /\bupdatedAt\b/);
  assert.doesNotMatch(slot, /\b(status|state|available|reserved)\b/i);
});

test('adds the forward-only S1-T17 database invariants', async () => {
  const sql = await readAvailabilitySlotMigration();

  assert.equal(
    [...sql.matchAll(/CREATE TABLE/gi)].length,
    1,
    'S1-T17 migration must create exactly one table',
  );
  assert.match(sql, /CREATE TABLE "AvailabilitySlot"/i);
  assert.match(sql, /CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY \("id"\)/i);
  assert.match(sql, /"startAtUtc"\s+TIMESTAMPTZ\(3\)\s+NOT NULL/i);
  assert.match(sql, /"endAtUtc"\s+TIMESTAMPTZ\(3\)\s+NOT NULL/i);
  assert.match(sql, /"createdAt"\s+TIMESTAMPTZ\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/i);
  assert.match(sql, /"deletedAt"\s+TIMESTAMPTZ\(3\)/i);
  assert.match(
    sql,
    /CONSTRAINT "AvailabilitySlot_time_order_check"\s+CHECK\s*\(\s*"startAtUtc"\s*<\s*"endAtUtc"\s*\)/i,
  );
  assert.match(
    sql,
    /CONSTRAINT "AvailabilitySlot_no_overlap_excl"\s+EXCLUDE USING GIST\s*\(\s*"tutorProfileId"\s+extensions\.gist_uuid_ops\s+WITH\s+=,\s*tstzrange\(\s*"startAtUtc",\s*"endAtUtc",\s*'\[\)'\s*\)\s+WITH\s+&&\s*\)\s*WHERE\s*\(\s*"deletedAt"\s+IS\s+NULL\s*\)/i,
  );
  assert.match(
    sql,
    /CREATE INDEX "AvailabilitySlot_tutorProfileId_startAtUtc_idx"\s+ON "AvailabilitySlot"\s*\(\s*"tutorProfileId",\s*"startAtUtc"\s*\)/i,
  );
  assert.match(
    sql,
    /ADD CONSTRAINT "AvailabilitySlot_tutorProfileId_fkey"[\s\S]*FOREIGN KEY \("tutorProfileId"\)[\s\S]*REFERENCES "TutorProfile"\("userId"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE/i,
  );
  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(sql, /CREATE\s+(TABLE|TYPE)\s+"?Booking/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\b(status|state|available|reserved)\b/i);
});

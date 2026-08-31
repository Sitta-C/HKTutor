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
  assert.doesNotMatch(schema, /model Booking\s*{/);
});

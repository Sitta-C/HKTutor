import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

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
  assert.doesNotMatch(schema, /model (AvailabilitySlot|Booking|Review)\s*{/);
});

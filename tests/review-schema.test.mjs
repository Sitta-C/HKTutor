import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { disposableDatabaseUrl } from '../apps/api/scripts/verify-review-database.mjs';

const migrationPath = 'apps/api/prisma/migrations/20261103120000_add_review/migration.sql';

function model(source, name) {
  const match = source.match(new RegExp(`model ${name}\\s*{([\\s\\S]*?)\\n}`));
  assert.ok(match, `model ${name} must exist`);
  return match[1];
}

test('S3-DB01 stores raw dimensions and private author, booking and tutor relationships', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  const review = model(schema, 'Review');
  assert.match(review, /id\s+String\s+@id @default\(uuid\(\)\) @db\.Uuid/);
  assert.match(review, /bookingId\s+String\s+@unique @db\.Uuid/);
  for (const [field, target, key, reference] of [
    ['author', 'User', 'authorStudentUserId', 'id'],
    ['tutorProfile', 'TutorProfile', 'tutorProfileId', 'userId'],
  ]) {
    assert.match(review, new RegExp(`${key}\\s+String\\s+(?:@unique )?@db\\.Uuid`));
    assert.match(
      review,
      new RegExp(
        `${field}\\s+${target}\\s+@relation\\(fields: \\[${key}\\], references: \\[${reference}\\], onDelete: Restrict, onUpdate: Cascade\\)`,
      ),
    );
  }
  assert.ok(
    review.includes(
      'bookingId, authorStudentUserId, tutorProfileId, bookingStatus], references: [id, studentUserId, tutorProfileId, status], onDelete: Restrict, onUpdate: Restrict',
    ),
  );
  assert.match(review, /bookingStatus\s+BookingStatus\s+@default\(COMPLETED\)/);
  for (const field of ['clarity', 'punctuality', 'preparation']) {
    assert.match(review, new RegExp(`\\n\\s*${field}\\s+Int\\s*\\n`));
  }
  assert.match(review, /feedback\s+String\s*\n/);
  assert.match(review, /createdAt\s+DateTime\s+@default\(now\(\)\) @db\.Timestamptz\(3\)/);
  assert.doesNotMatch(review, /overallRating|ratingAverage|Json|email|displayName/);
  assert.match(model(schema, 'User'), /authoredReviews\s+Review\[\]/);
  assert.match(model(schema, 'TutorProfile'), /reviews\s+Review\[\]/);
  assert.match(model(schema, 'Booking'), /review\s+Review\?/);
});

test('S3-DB01 preserves migration history and enforces cross-row evidence under locks', async () => {
  const sql = await fs.readFile(migrationPath, 'utf8');
  const review = model(await fs.readFile('apps/api/prisma/schema.prisma', 'utf8'), 'Review');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  for (const field of ['clarity', 'punctuality', 'preparation']) {
    assert.ok(sql.includes(`"${field}" INTEGER NOT NULL`));
    assert.ok(
      sql.includes(`CONSTRAINT "Review_${field}_check" CHECK ("${field}" BETWEEN 1 AND 5)`),
    );
  }
  assert.match(sql, /CHAR_LENGTH\("feedback"\) BETWEEN 1 AND 1000/);
  assert.match(sql, /"feedback" = BTRIM\("feedback", U&'/);
  for (const character of ['0009', '00A0', '200A', '2028', 'FEFF']) {
    assert.ok(sql.includes(`\\${character}`));
  }
  assert.match(sql, /CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"\("bookingId"\)/);
  assert.ok(
    review.includes(
      '@@index([tutorProfileId, createdAt(sort: Desc), id(sort: Desc)], map: "Review_tutorProfileId_createdAt_id_idx")',
    ),
  );
  assert.match(sql, /ON "Review"\("tutorProfileId", "createdAt" DESC, "id" DESC\)/);
  assert.match(review, /@@index\(\[authorStudentUserId\]/);
  assert.match(
    sql,
    /CONSTRAINT "Review_completed_booking_check" CHECK \("bookingStatus" = 'completed'\)/,
  );
  assert.match(sql, /CREATE UNIQUE INDEX "Booking_review_identity_key"/);
  assert.match(
    sql,
    /FOREIGN KEY \("bookingId", "authorStudentUserId", "tutorProfileId", "bookingStatus"\)/,
  );
  assert.match(
    sql,
    /REFERENCES "Booking"\("id", "studentUserId", "tutorProfileId", "status"\)\s+ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(
    sql,
    /UPDATE "TutorProfile" SET "ratingAverage" = NULL, "reviewCount" = 0, "ratingUpdatedAt" = NULL/,
  );
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "Review"/);
  assert.match(sql, /ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE "Review" FROM PUBLIC/);
  assert.match(sql, /rolname IN \('anon', 'authenticated'\)/);
  assert.doesNotMatch(
    sql,
    /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)|INSERT INTO "Review"/i,
  );
});

test('review verifier refuses unapproved, remote, shared and redirected targets', () => {
  const safe = 'postgresql://tester@127.0.0.1:55442/hktutor_review_test';
  assert.throws(() => disposableDatabaseUrl({ DATABASE_URL: safe }));
  for (const url of [
    undefined,
    'invalid',
    'https://localhost/hktutor_review_test',
    'postgresql://tester@database.example.test/hktutor_review_test',
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
    const url = `postgresql://tester@${host}:55442/hktutor_review_test`;
    assert.equal(
      disposableDatabaseUrl({ HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1', DATABASE_URL: url }),
      url,
    );
  }
});

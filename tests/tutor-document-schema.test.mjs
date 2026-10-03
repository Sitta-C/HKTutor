import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const schemaPath = 'apps/api/prisma/schema.prisma';
const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_add_tutor_document';

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

  assert.equal(migrations.length, 1, 'S2-DB02 migration must exist exactly once');
  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('defines the S2-DB02 TutorDocument Prisma boundary', async () => {
  const schema = await fs.readFile(schemaPath, 'utf8');
  const reviewStatus = readBlock(schema, 'enum', 'TutorDocumentReviewStatus');
  const user = readBlock(schema, 'model', 'User');
  const tutorProfile = readBlock(schema, 'model', 'TutorProfile');
  const tutorDocument = readBlock(schema, 'model', 'TutorDocument');

  assert.match(reviewStatus, /PENDING\s+@map\("pending"\)/);
  assert.match(reviewStatus, /VERIFIED\s+@map\("verified"\)/);
  assert.match(reviewStatus, /REJECTED\s+@map\("rejected"\)/);
  assert.equal([...reviewStatus.matchAll(/@map\(/g)].length, 3);

  for (const field of [
    'tutorUserId',
    'documentType',
    'objectPath',
    'originalName',
    'mimeType',
    'sizeBytes',
    'reviewStatus',
    'reviewerUserId',
    'reviewedAt',
    'rejectionReason',
    'createdAt',
    'updatedAt',
  ]) {
    assert.match(tutorDocument, new RegExp(`\\n\\s*${field}\\s+`));
  }

  assert.match(tutorDocument, /objectPath\s+String\s+@unique/);
  assert.match(tutorDocument, /reviewStatus\s+TutorDocumentReviewStatus\s+@default\(PENDING\)/);
  assert.match(
    tutorDocument,
    /tutor\s+TutorProfile\s+@relation\(fields:\s*\[tutorUserId\],\s*references:\s*\[userId\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(
    tutorDocument,
    /reviewer\s+User\?\s+@relation\("TutorDocumentReviewer",\s*fields:\s*\[reviewerUserId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(tutorProfile, /documents\s+TutorDocument\[\]/);
  assert.match(
    user,
    /reviewedDocuments\s+TutorDocument\[\]\s+@relation\("TutorDocumentReviewer"\)/,
  );
  assert.match(
    tutorDocument,
    /@@index\(\[tutorUserId, reviewStatus, createdAt\],\s*map:\s*"TutorDocument_tutorUserId_reviewStatus_createdAt_idx"\)/,
  );
  assert.match(
    tutorDocument,
    /@@index\(\[reviewStatus, createdAt\],\s*map:\s*"TutorDocument_reviewStatus_createdAt_idx"\)/,
  );
  assert.doesNotMatch(tutorDocument, /publicUrl|signedUrl|fileBytes|serviceKey/i);
});

test('migrates private TutorDocument metadata with size, MIME and review constraints', async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /CREATE TYPE "TutorDocumentReviewStatus" AS ENUM \('pending', 'verified', 'rejected'\)/i,
  );
  assert.match(sql, /CREATE TABLE "TutorDocument"/i);
  assert.match(
    sql,
    /FOREIGN KEY \("tutorUserId"\) REFERENCES "TutorProfile"\("userId"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/i,
  );
  assert.match(
    sql,
    /FOREIGN KEY \("reviewerUserId"\) REFERENCES "User"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/i,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "TutorDocument_objectPath_key"\s+ON "TutorDocument"\("objectPath"\)/i,
  );
  assert.match(
    sql,
    /CREATE INDEX "TutorDocument_tutorUserId_reviewStatus_createdAt_idx"\s+ON "TutorDocument"\("tutorUserId", "reviewStatus", "createdAt"\)/i,
  );
  assert.match(
    sql,
    /CREATE INDEX "TutorDocument_reviewStatus_createdAt_idx"\s+ON "TutorDocument"\("reviewStatus", "createdAt"\)/i,
  );

  for (const constraint of [
    'TutorDocument_size_bytes_check',
    'TutorDocument_text_metadata_check',
    'TutorDocument_mime_type_check',
    'TutorDocument_private_object_path_check',
    'TutorDocument_review_fields_check',
  ]) {
    assert.match(sql, new RegExp(`CONSTRAINT "${constraint}"\\s+CHECK`, 'i'));
  }

  assert.match(sql, /"sizeBytes" > 0 AND "sizeBytes" <= 5242880/i);
  assert.match(sql, /"mimeType" IN \('application\/pdf', 'image\/jpeg', 'image\/png'\)/i);
  assert.match(sql, /POSITION\('\/\.\.\/' IN '\/' \|\| "objectPath" \|\| '\/'\) = 0/i);
  assert.match(sql, /"objectPath" !~\* '\^.*:\/\/'/i);
  assert.match(
    sql,
    /"reviewStatus" = 'pending'[\s\S]*?"reviewerUserId" IS NULL[\s\S]*?"reviewedAt" IS NULL/i,
  );
  assert.match(
    sql,
    /"reviewStatus" = 'rejected'[\s\S]*?"rejectionReason" IS NOT NULL[\s\S]*?"rejectionReason" <> ''/i,
  );
});

test('enforces tutor/admin roles and one-way review transitions before persistence', async () => {
  const sql = await readMigration();

  assert.match(sql, /CREATE FUNCTION "validate_tutor_document_write"\(\)/i);
  assert.match(sql, /tutor_role IS DISTINCT FROM 'tutor'/i);
  assert.match(sql, /reviewer_role IS DISTINCT FROM 'admin'/i);
  assert.match(sql, /TG_OP = 'INSERT' AND NEW\."reviewStatus" <> 'pending'/i);
  assert.match(sql, /NEW\."documentType" IS DISTINCT FROM OLD\."documentType"/i);
  assert.match(sql, /TutorDocument upload metadata is immutable/i);
  assert.match(
    sql,
    /OLD\."reviewStatus" = 'pending'\s+AND NEW\."reviewStatus" IN \('verified', 'rejected'\)/i,
  );
  assert.match(sql, /TutorDocument completed review metadata is immutable/i);
  assert.match(
    sql,
    /CREATE TRIGGER "TutorDocument_validate_write"\s+BEFORE INSERT OR UPDATE ON "TutorDocument"/i,
  );

  assert.doesNotMatch(sql, /\b(INSERT\s+INTO|UPDATE\s+"TutorDocument"|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)/i);
});

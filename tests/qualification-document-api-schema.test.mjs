import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const migration =
  'apps/api/prisma/migrations/20261006150000_qualification_document_api/migration.sql';

test('qualification audit schema retains canonical document and actor relations', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  const audit = schema.match(/model TutorDocumentAudit\s*{([\s\S]*?)\n}/)?.[1];
  assert.ok(audit);
  assert.match(
    schema,
    /enum TutorDocumentAuditAction\s*{[\s\S]*?UPLOADED\s+@map\("uploaded"\)[\s\S]*?SIGNED_URL_ISSUED\s+@map\("signed_url_issued"\)[\s\S]*?REVIEWED\s+@map\("reviewed"\)/,
  );
  assert.match(audit, /decision\s+TutorDocumentReviewStatus\?/);
  assert.match(audit, /expiresAt\s+DateTime\?\s+@db.Timestamptz\(3\)/);
  assert.match(
    audit,
    /document\s+TutorDocument\s+@relation\(fields: \[documentId\], references: \[id\], onDelete: Restrict, onUpdate: Cascade\)/,
  );
  assert.match(
    audit,
    /actor\s+User\s+@relation\(fields: \[actorUserId\], references: \[id\], onDelete: Restrict, onUpdate: Cascade\)/,
  );
  assert.doesNotMatch(audit, /objectPath|signedUrl|serviceKey|fileBytes/i);
});

test('pending upload and single review constraints survive deployment', async () => {
  const sql = await fs.readFile(migration, 'utf8');
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "TutorDocument_one_pending_type"\s+ON "TutorDocument" \("tutorUserId", "documentType"\)\s+WHERE "reviewStatus" = 'pending'/,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "TutorDocumentAudit_one_review"\s+ON "TutorDocumentAudit" \("documentId"\) WHERE "action" = 'reviewed'/,
  );
  assert.match(sql, /"decision" IS NOT NULL AND "decision" IN \('verified', 'rejected'\)/);
  assert.match(sql, /"decision" <> 'rejected' OR "reason" IS NOT NULL/);
  assert.match(sql, /"reason" = BTRIM\("reason"\) AND LENGTH\("reason"\) BETWEEN 1 AND 500/);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE "TutorDocument")\b/i);
});

test('private preview audit evidence is bounded and append-only', async () => {
  const sql = await fs.readFile(migration, 'utf8');
  assert.match(
    sql,
    /"action" = 'signed_url_issued' AND "decision" IS NULL AND "reason" IS NULL AND "expiresAt" IS NOT NULL/,
  );
  assert.match(
    sql,
    /"expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" \+ INTERVAL '5 minutes'/,
  );
  assert.match(sql, /BEFORE UPDATE OR DELETE ON "TutorDocumentAudit"/);
  assert.match(sql, /ERRCODE = '23514'[\s\S]*?TutorDocumentAudit evidence is append-only/);
  assert.match(sql, /REFERENCES "TutorDocument"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /REFERENCES "User"\("id"\) ON DELETE RESTRICT/);
});

test('shared storage cleanup persists typed paths and attempts without file bytes or credentials', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  const intent = schema.match(/model StorageCleanupIntent\s*{([\s\S]*?)\n}/)?.[1];
  assert.ok(intent);
  assert.match(intent, /purpose\s+StorageObjectPurpose/);
  assert.match(intent, /objectPath\s+String/);
  assert.match(intent, /nextAttemptAt\s+DateTime\s+@db.Timestamptz\(3\)/);
  assert.match(intent, /attempts\s+Int\s+@default\(0\)/);
  assert.match(intent, /@@id\(\[purpose, objectPath\]\)/);
  assert.doesNotMatch(intent, /buffer|fileBytes|signedUrl|secret|token/i);
});

test('recovery forward migration reconciles profile state without modifying document evidence', async () => {
  const sql = await fs.readFile(
    'apps/api/prisma/migrations/20261006200000_qualification_upload_recovery/migration.sql',
    'utf8',
  );
  assert.match(sql, /CHECK \("attempts" >= 0\)/);
  assert.match(sql, /CREATE INDEX "QualificationUploadIntent_nextAttemptAt_idx"/);
  assert.match(
    sql,
    /UPDATE "TutorProfile" AS tutor[\s\S]*?WHEN EXISTS[\s\S]*?'verified'[\s\S]*?WHEN EXISTS[\s\S]*?'pending'[\s\S]*?ELSE 'rejected'/,
  );
  assert.match(
    sql,
    /WHERE EXISTS \(SELECT 1 FROM "TutorDocument" WHERE "tutorUserId" = tutor\."userId"\)/,
  );
  assert.doesNotMatch(sql, /UPDATE "TutorDocument"|DELETE FROM|DROP TABLE|TRUNCATE/i);
});

test('unapplied avatar migration converts the existing queue without losing pending work', async () => {
  const sql = await fs.readFile(
    'apps/api/prisma/migrations/20261006210000_add_user_avatar/migration.sql',
    'utf8',
  );
  assert.match(
    sql,
    /CREATE TYPE "StorageObjectPurpose" AS ENUM \('AVATAR', 'QUALIFICATION_DOCUMENT'\)/,
  );
  assert.match(sql, /ALTER TABLE "QualificationUploadIntent" RENAME TO "StorageCleanupIntent"/);
  assert.match(sql, /DEFAULT 'QUALIFICATION_DOCUMENT'/);
  assert.match(sql, /PRIMARY KEY \("purpose", "objectPath"\)/);
  assert.match(sql, /CREATE INDEX "StorageCleanupIntent_nextAttemptAt_purpose_idx"/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test('qualification metadata cannot bypass Nest authorization through Supabase browser roles', async () => {
  const sql = await fs.readFile(
    'apps/api/prisma/migrations/20261006201000_protect_qualification_metadata/migration.sql',
    'utf8',
  );
  for (const table of ['TutorDocument', 'TutorDocumentAudit', 'QualificationUploadIntent']) {
    assert.ok(sql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(
    sql,
    /REVOKE ALL ON TABLE "TutorDocument", "TutorDocumentAudit", "QualificationUploadIntent" FROM PUBLIC/,
  );
  assert.match(sql, /rolname IN \('anon', 'authenticated'\)/);
  assert.match(sql, /FROM %I/);
  assert.doesNotMatch(
    sql,
    /FORCE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|CREATE POLICY|DROP TABLE|TRUNCATE/,
  );
});

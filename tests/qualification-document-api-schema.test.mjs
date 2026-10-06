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

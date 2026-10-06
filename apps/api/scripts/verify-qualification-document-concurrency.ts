import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import 'reflect-metadata';

import { StorageConfigService } from '@config/storage.config';
import {
  Role,
  StorageObjectPurpose,
  TutorDocumentReviewStatus,
  TutorVerificationStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageCleanupService } from '@infrastructure/storage/storage-cleanup.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import {
  QualificationDecision,
  QualificationDocumentType,
} from '@modules/qualification-documents/qualification-documents.dto';
import { QualificationDocumentsService } from '@modules/qualification-documents/qualification-documents.service';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type {} from 'multer';

const databaseUrl = process.env['DATABASE_URL'];
assert.ok(databaseUrl, 'DATABASE_URL is required');
assert.equal(
  process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
  '1',
  'Explicit disposable database opt-in is required',
);
const parsed = new URL(databaseUrl);
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname),
  'Verification refuses remote databases',
);
assert.match(
  decodeURIComponent(parsed.pathname.slice(1)),
  /^hktutor[-_].*[-_]test$/,
  'Use a disposable hktutor_*_test database',
);

const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
const objects = new Set<string>();
let deletionUnavailable = false;
let deletionStarted: (() => void) | undefined;
let deletionGate: Promise<void> | undefined;
const config = new StorageConfigService(
  new ConfigService({
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_test_only',
    SUPABASE_AVATAR_BUCKET: 'test-avatars',
    SUPABASE_DOCUMENT_BUCKET: 'test-documents',
  }),
);
const storage = new StorageService(
  config,
  createClient<Record<string, never>>(config.values.url, config.values.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        let body: unknown = { public: false };
        if (init?.method === 'DELETE') {
          if (deletionUnavailable) {
            throw new Error('Simulated storage outage');
          }
          deletionStarted?.();
          await deletionGate;
          assert.ok(typeof init.body === 'string');
          const decoded: unknown = JSON.parse(init.body);
          assert.ok(
            decoded &&
              typeof decoded === 'object' &&
              'prefixes' in decoded &&
              Array.isArray(decoded.prefixes),
          );
          for (const path of decoded.prefixes) {
            assert.equal(typeof path, 'string');
            if (typeof path === 'string') {
              objects.delete(path);
            }
          }
          body = [];
        } else if (init?.method === 'POST') {
          const path = new URL(url).pathname.split('/object/test-documents/')[1];
          assert.ok(path);
          objects.add(path);
          body = { Key: path, Id: randomUUID() };
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  }),
);
const cleanup = new StorageCleanupService(prisma, storage);
const documents = new QualificationDocumentsService(prisma, storage, cleanup);
const pdf = Buffer.from('%PDF-1.4\n%%EOF');
const file: Express.Multer.File = {
  fieldname: 'file',
  originalname: 'degree.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  size: pdf.length,
  buffer: pdf,
  destination: '',
  filename: '',
  path: '',
  stream: new Readable(),
};

async function actor(role: Role): Promise<AuthenticatedUser> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      role,
      email: `${id}@qualification.test`,
      consentAcceptedAt: new Date(),
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      ...(role === Role.TUTOR
        ? {
            tutorProfile: {
              create: { displayName: 'Qualification probe', bio: '', experienceYears: 0 },
            },
          }
        : {}),
    },
  });
  return { id, role, email: `${id}@qualification.test`, sessionId: randomUUID() };
}

const FAILURE_FUNCTION = `CREATE FUNCTION "qualification_test_fail_audit"() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'Qualification rollback probe' USING ERRCODE = '23514'; END; $$`;

async function installFailureProbe(): Promise<void> {
  await prisma.$executeRawUnsafe(FAILURE_FUNCTION);
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER "qualification_test_fail_audit" BEFORE INSERT ON "TutorDocumentAudit" FOR EACH ROW EXECUTE FUNCTION "qualification_test_fail_audit"()',
  );
}

async function dropFailureProbe(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "qualification_test_fail_audit" ON "TutorDocumentAudit"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "qualification_test_fail_audit"()');
}

async function verifyReconciliation(admin: AuthenticatedUser): Promise<void> {
  const cases = [
    {
      statuses: [TutorDocumentReviewStatus.VERIFIED, TutorDocumentReviewStatus.REJECTED],
      before: TutorVerificationStatus.REJECTED,
      after: TutorVerificationStatus.VERIFIED,
    },
    {
      statuses: [TutorDocumentReviewStatus.PENDING, TutorDocumentReviewStatus.REJECTED],
      before: TutorVerificationStatus.REJECTED,
      after: TutorVerificationStatus.PENDING,
    },
    {
      statuses: [TutorDocumentReviewStatus.REJECTED],
      before: TutorVerificationStatus.VERIFIED,
      after: TutorVerificationStatus.REJECTED,
    },
    {
      statuses: [],
      before: TutorVerificationStatus.VERIFIED,
      after: TutorVerificationStatus.VERIFIED,
    },
  ];
  const fixtures: {
    id: string;
    before: TutorVerificationStatus;
    after: TutorVerificationStatus;
  }[] = [];
  for (const scenario of cases) {
    const tutor = await actor(Role.TUTOR);
    for (const [index, status] of scenario.statuses.entries()) {
      const document = await documents.upload(
        tutor,
        {
          documentType:
            index === 0 ? QualificationDocumentType.DEGREE : QualificationDocumentType.CERTIFICATE,
        },
        file,
      );
      if (status !== TutorDocumentReviewStatus.PENDING) {
        await documents.review(admin, document.documentId, {
          decision:
            status === TutorDocumentReviewStatus.VERIFIED
              ? QualificationDecision.APPROVED
              : QualificationDecision.REJECTED,
          reason: 'Migration verification',
        });
      }
    }
    fixtures.push({ id: tutor.id, before: scenario.before, after: scenario.after });
  }
  const migration = readFileSync(
    resolve(
      __dirname,
      '../prisma/migrations/20261006200000_qualification_upload_recovery/migration.sql',
    ),
    'utf8',
  );
  const start = migration.indexOf('UPDATE "TutorProfile"');
  assert.ok(start > 0);
  await prisma.$transaction(async (tx) => {
    for (const fixture of fixtures) {
      await tx.tutorProfile.update({
        where: { userId: fixture.id },
        data: { verificationStatus: fixture.before },
      });
    }
    const select = {
      id: true,
      reviewStatus: true,
      reviewedAt: true,
      reviewerUserId: true,
      rejectionReason: true,
    } as const;
    const before = await tx.tutorDocument.findMany({ select, orderBy: { id: 'asc' } });
    const noDocuments = fixtures.at(-1);
    assert.ok(noDocuments);
    const untouched = await tx.tutorProfile.findUniqueOrThrow({
      where: { userId: noDocuments.id },
    });
    await tx.$executeRawUnsafe(migration.slice(start, migration.lastIndexOf('COMMIT;')));
    for (const fixture of fixtures) {
      const tutor = await tx.tutorProfile.findUniqueOrThrow({ where: { userId: fixture.id } });
      assert.equal(tutor.verificationStatus, fixture.after);
    }
    assert.deepEqual(await tx.tutorDocument.findMany({ select, orderBy: { id: 'asc' } }), before);
    assert.deepEqual(
      await tx.tutorProfile.findUniqueOrThrow({ where: { userId: noDocuments.id } }),
      untouched,
    );
  });
}

async function verifyMetadataPrivacy(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ rlsEnabled: boolean }>>`
    SELECT c.relrowsecurity AS "rlsEnabled" FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('TutorDocument', 'TutorDocumentAudit', 'StorageCleanupIntent')`;
  assert.equal(tables.length, 3);
  assert.ok(tables.every((table) => table.rlsEnabled));
  const privileges = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
    SELECT has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS allowed
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN pg_roles r
    WHERE n.nspname = 'public'
      AND c.relname IN ('TutorDocument', 'TutorDocumentAudit', 'StorageCleanupIntent')
      AND r.rolname IN ('anon', 'authenticated')`;
  assert.ok(privileges.every((privilege) => !privilege.allowed));
}

async function verify(): Promise<void> {
  const tutor = await actor(Role.TUTOR);
  const admin = await actor(Role.ADMIN);
  const uploads = await Promise.allSettled(
    [1, 2].map(() =>
      documents.upload(tutor, { documentType: QualificationDocumentType.DEGREE }, file),
    ),
  );
  const successes = uploads.filter((result) => result.status === 'fulfilled');
  const failures = uploads.filter((result) => result.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.ok(failures[0]?.reason instanceof ConflictException);
  const uploaded = successes[0];
  assert.ok(uploaded);
  assert.equal(await prisma.tutorDocument.count({ where: { tutorUserId: tutor.id } }), 1);
  assert.equal(
    await prisma.storageCleanupIntent.count({
      where: { purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT },
    }),
    0,
  );
  assert.equal(objects.size, 1);

  const reviews = await Promise.allSettled(
    [QualificationDecision.APPROVED, QualificationDecision.REJECTED].map((decision) =>
      documents.review(admin, uploaded.value.documentId, { decision, reason: 'Review probe' }),
    ),
  );
  assert.equal(reviews.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(
    reviews.some(
      (result) => result.status === 'rejected' && result.reason instanceof ConflictException,
    ),
  );
  assert.equal(
    await prisma.tutorDocumentAudit.count({
      where: { documentId: uploaded.value.documentId, action: 'REVIEWED' },
    }),
    1,
  );

  const otherTutor = await actor(Role.TUTOR);
  const degree = await documents.upload(
    otherTutor,
    { documentType: QualificationDocumentType.DEGREE },
    file,
  );
  const certificate = await documents.upload(
    otherTutor,
    { documentType: QualificationDocumentType.CERTIFICATE },
    file,
  );
  const rejected = await documents.review(admin, degree.documentId, {
    decision: QualificationDecision.REJECTED,
    reason: 'Unreadable',
  });
  assert.equal(rejected.tutorVerificationStatus, 'PENDING');
  await documents.review(admin, certificate.documentId, {
    decision: QualificationDecision.APPROVED,
  });
  const newDegree = await documents.upload(
    otherTutor,
    { documentType: QualificationDocumentType.DEGREE },
    file,
  );
  const stillVerified = await documents.review(admin, newDegree.documentId, {
    decision: QualificationDecision.REJECTED,
    reason: 'Unreadable',
  });
  assert.equal(stillVerified.tutorVerificationStatus, 'VERIFIED');

  const rollbackTutor = await actor(Role.TUTOR);
  await installFailureProbe();
  deletionUnavailable = true;
  try {
    await assert.rejects(
      documents.upload(rollbackTutor, { documentType: QualificationDocumentType.DEGREE }, file),
      ServiceUnavailableException,
    );
  } finally {
    deletionUnavailable = false;
    await dropFailureProbe();
  }
  assert.equal(await prisma.tutorDocument.count({ where: { tutorUserId: rollbackTutor.id } }), 0);
  const intent = await prisma.storageCleanupIntent.findFirstOrThrow({
    where: { purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT },
  });
  assert.equal(intent.attempts, 1);
  assert.ok(objects.has(intent.objectPath));
  await prisma.storageCleanupIntent.update({
    where: {
      purpose_objectPath: {
        purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
        objectPath: intent.objectPath,
      },
    },
    data: { nextAttemptAt: new Date(0) },
  });
  await cleanup.recoverPending();
  assert.equal(
    await prisma.storageCleanupIntent.count({
      where: { purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT },
    }),
    0,
  );
  assert.ok(!objects.has(intent.objectPath));

  const pending = await documents.upload(
    rollbackTutor,
    { documentType: QualificationDocumentType.DEGREE },
    file,
  );
  await installFailureProbe();
  try {
    await assert.rejects(
      documents.review(admin, pending.documentId, { decision: QualificationDecision.APPROVED }),
      ServiceUnavailableException,
    );
  } finally {
    await dropFailureProbe();
  }
  assert.equal(
    (await prisma.tutorDocument.findUniqueOrThrow({ where: { id: pending.documentId } }))
      .reviewStatus,
    TutorDocumentReviewStatus.PENDING,
  );
  assert.equal(
    (await prisma.tutorProfile.findUniqueOrThrow({ where: { userId: rollbackTutor.id } }))
      .verificationStatus,
    'PENDING',
  );
  assert.equal(
    await prisma.tutorDocumentAudit.count({
      where: { documentId: pending.documentId, action: 'REVIEWED' },
    }),
    0,
  );

  const reference = await prisma.tutorDocument.findUniqueOrThrow({
    where: { id: pending.documentId },
  });
  await prisma.storageCleanupIntent.create({
    data: {
      purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
      objectPath: reference.objectPath,
      nextAttemptAt: new Date(0),
    },
  });
  await cleanup.cleanup({
    purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
    objectPath: reference.objectPath,
  });
  assert.ok(objects.has(reference.objectPath), 'Recovery must preserve referenced objects');

  const prepared = storage.prepareDocument(tutor.id, { buffer: pdf, mimeType: 'application/pdf' });
  await prisma.storageCleanupIntent.create({
    data: {
      purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
      objectPath: prepared.objectPath,
      nextAttemptAt: new Date(0),
    },
  });
  await storage.uploadPrepared(prepared);
  let releaseDeletion = () => {};
  deletionGate = new Promise<void>((resolve) => {
    releaseDeletion = resolve;
  });
  const started = new Promise<void>((resolve) => {
    deletionStarted = resolve;
  });
  const target = {
    purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
    objectPath: prepared.objectPath,
  };
  const firstWorker = cleanup.cleanup(target);
  await started;
  const secondWorker = new StorageCleanupService(prisma, storage);
  assert.equal(
    await secondWorker.cleanup(target),
    'empty',
    'Other workers must skip the locked intent',
  );
  releaseDeletion();
  await firstWorker;
  deletionGate = undefined;
  deletionStarted = undefined;
  assert.ok(!objects.has(prepared.objectPath));
  await verifyReconciliation(admin);
  await verifyMetadataPrivacy();
  process.stdout.write(
    'Qualification database verification passed: upload/review races, aggregate status, rollback, durable retries, reference protection, worker locking, migration reconciliation, metadata RLS/client grants.\n',
  );
}

void prisma
  .$connect()
  .then(verify)
  .finally(async () => {
    await dropFailureProbe();
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    process.stderr.write(
      error instanceof Error ? `${error.message}\n` : 'Qualification verification failed\n',
    );
    process.exitCode = 1;
  });

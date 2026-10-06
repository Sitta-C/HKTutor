import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { StorageConfigService } from '@config/storage.config';
import { Prisma } from '@generated/prisma/client';
import { Role, TutorDocumentReviewStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { DOCUMENT_MAX_SIZE_BYTES } from '@infrastructure/storage/storage.types';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  AdminTutorVerificationsController,
  TutorQualificationDocumentsController,
} from '@modules/qualification-documents/qualification-documents.controller';
import { QualificationStatus } from '@modules/qualification-documents/qualification-documents.dto';
import { encodeQualificationCursor } from '@modules/qualification-documents/qualification-documents.model';
import { QualificationDocumentsService } from '@modules/qualification-documents/qualification-documents.service';

import type { DocumentMetadata } from '@modules/qualification-documents/qualification-documents.model';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_TUTOR_ID = '20000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const DOCUMENT_ID = '40000000-0000-4000-8000-000000000002';
const TUTOR_BASE = '/api/v1/tutors/me/qualification-documents';
const ADMIN_BASE = '/api/v1/admin/tutor-verifications';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZi8AAAAASUVORK5CYII=',
  'base64',
);
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const ENVIRONMENT = {
  SUPABASE_URL: 'https://storage.example.test',
  SUPABASE_SECRET_KEY: 'sb_secret_e2e_placeholder',
  SUPABASE_AVATAR_BUCKET: 'test-avatars',
  SUPABASE_DOCUMENT_BUCKET: 'test-documents',
};

interface AuditData {
  documentId: string;
  actorUserId: string;
  action: string;
  decision?: TutorDocumentReviewStatus;
  reason?: string | null;
  createdAt?: Date;
  expiresAt?: Date;
}

interface DocumentFixture extends DocumentMetadata {
  objectPath: string;
  tutor: { userId: string; displayName: string; verificationStatus: string };
  auditEvents: {
    actorUserId: string;
    createdAt: Date;
    decision: TutorDocumentReviewStatus;
    reason: string | null;
  }[];
}

function fixture(): DocumentFixture {
  return {
    id: DOCUMENT_ID,
    tutorUserId: TUTOR_ID,
    documentType: 'DEGREE',
    objectPath: `${TUTOR_ID}/10000000-0000-4000-8000-000000000001.pdf`,
    originalName: 'degree.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    reviewStatus: TutorDocumentReviewStatus.PENDING,
    reviewerUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date('2026-10-05T01:00:00.000Z'),
    tutor: { userId: TUTOR_ID, displayName: 'Tutor', verificationStatus: 'PENDING' },
    auditEvents: [],
  };
}

function storageResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(value: RequestInfo | URL): string {
  return typeof value === 'string' ? value : value instanceof URL ? value.href : value.url;
}

function matchingType(type: typeof String | typeof Date | typeof Array | typeof Object): unknown {
  return expect.any(type);
}

function matchingObject(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value);
}

describe('S2-T07 qualification documents (HTTP contracts with isolated persistence)', () => {
  let app: INestApplication<App>;
  let document = fixture();
  let auditRecords: AuditData[] = [];
  let verificationStatus = 'PENDING';
  let transactionTail = Promise.resolve();
  const findFirst = jest.fn<Promise<typeof document | null>, [Prisma.TutorDocumentFindFirstArgs]>();
  const findMany = jest.fn<Promise<Array<typeof document>>, [Prisma.TutorDocumentFindManyArgs]>();
  const createDocument = jest.fn(
    (args: {
      data: {
        tutorUserId: string;
        documentType: string;
        objectPath: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
      };
    }) => {
      document = { ...fixture(), ...args.data };
      return Promise.resolve(document);
    },
  );
  const updateDocument = jest.fn(
    (args: {
      data: {
        reviewStatus: TutorDocumentReviewStatus;
        reviewerUserId: string;
        reviewedAt: Date;
        rejectionReason: string | null;
      };
    }) => {
      if (document.reviewStatus !== TutorDocumentReviewStatus.PENDING) {
        return Promise.resolve({ count: 0 });
      }
      document = { ...document, ...args.data };
      return Promise.resolve({ count: 1 });
    },
  );
  const createAudit = jest.fn(({ data }: { data: AuditData }) => {
    auditRecords.push(data);
    return Promise.resolve({ id: 'audit-id' });
  });
  const updateTutor = jest.fn(({ data }: { data: { verificationStatus: string } }) => {
    verificationStatus = data.verificationStatus;
    return Promise.resolve({ userId: TUTOR_ID });
  });
  const findTutorAccount = jest.fn(() =>
    Promise.resolve({
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      tutorProfile: { userId: TUTOR_ID },
    }),
  );
  const lockTutor = jest.fn(() => Promise.resolve([{ userId: TUTOR_ID }]));
  const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
  const verifyToken = jest.fn((token: string) => {
    const id = token === 'admin' ? ADMIN_ID : token === 'student' ? STUDENT_ID : TUTOR_ID;
    return ['admin', 'student', 'tutor'].includes(token) ? { sid: token, sub: id } : null;
  });
  const findSession = jest.fn(({ where }: { where: { id: string } }) => {
    const role =
      where.id === 'admin' ? Role.ADMIN : where.id === 'student' ? Role.STUDENT : Role.TUTOR;
    const userId = role === Role.ADMIN ? ADMIN_ID : role === Role.STUDENT ? STUDENT_ID : TUTOR_ID;
    return Promise.resolve({
      id: where.id,
      userId,
      revokedAt: null as Date | null,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      user: {
        id: userId,
        email: 'test@example.test',
        role,
        deletedAt: null,
        accountStatus: 'ACTIVE',
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });
  const tx = {
    user: { findFirst: findTutorAccount },
    tutorDocument: { findFirst, findMany, create: createDocument, updateMany: updateDocument },
    tutorDocumentAudit: { create: createAudit },
    tutorProfile: { update: updateTutor },
    $queryRaw: lockTutor,
  };
  // Models rollback and contention at the service boundary; this does not replace PostgreSQL tests.
  const transaction = jest.fn(async <T>(work: (client: typeof tx) => Promise<T>): Promise<T> => {
    const previous = transactionTail;
    let release = () => {};
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const before = { document, audits: [...auditRecords], verificationStatus };
    try {
      return await work(tx);
    } catch (error) {
      document = before.document;
      auditRecords = before.audits;
      verificationStatus = before.verificationStatus;
      throw error;
    } finally {
      release();
    }
  });

  beforeAll(async () => {
    const config = new StorageConfigService(new ConfigService(ENVIRONMENT));
    const client = createClient<Record<string, never>>(config.values.url, config.values.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: fetchMock },
    });
    const module = await Test.createTestingModule({
      controllers: [TutorQualificationDocumentsController, AdminTutorVerificationsController],
      providers: [
        QualificationDocumentsService,
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        {
          provide: PrismaService,
          useValue: { ...tx, authSession: { findUnique: findSession }, $transaction: transaction },
        },
        { provide: JwtTokenService, useValue: { verifyAccessToken: verifyToken } },
        { provide: StorageService, useValue: new StorageService(config, client) },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    document = fixture();
    auditRecords = [];
    verificationStatus = 'PENDING';
    findFirst
      .mockReset()
      .mockImplementation((args) => Promise.resolve(args.where?.reviewStatus ? null : document));
    findMany.mockReset().mockResolvedValue([document]);
    createDocument.mockClear();
    updateDocument.mockClear();
    createAudit.mockClear();
    updateTutor.mockClear();
    findTutorAccount.mockClear();
    lockTutor.mockClear();
    fetchMock.mockReset().mockImplementation((url, init) => {
      if (requestUrl(url).includes('/bucket/')) {
        return Promise.resolve(storageResponse({ id: 'test-documents', public: false }));
      }
      if (requestUrl(url).includes('/object/sign/')) {
        return Promise.resolve(
          storageResponse({ signedURL: '/object/sign/test-documents/preview?token=test' }),
        );
      }
      return Promise.resolve(
        storageResponse(init?.method === 'DELETE' ? [] : { Key: 'uploaded', Id: 'file-id' }),
      );
    });
  });

  it.each([
    [PDF, 'application/pdf', 'pdf'],
    [PNG, 'image/png', 'png'],
    [JPEG, 'image/jpeg', 'jpg'],
  ])(
    'uploads valid %s documents with safe metadata and an upload audit',
    async (buffer, mime, extension) => {
      const result = await request(app.getHttpServer())
        .post(TUTOR_BASE)
        .auth('tutor', { type: 'bearer' })
        .field('documentType', 'DEGREE')
        .attach('file', buffer, { filename: `degree.${extension}`, contentType: mime })
        .expect(201);
      expect(result.body).toEqual({
        documentId: DOCUMENT_ID,
        status: 'PENDING',
        fileName: `degree.${extension}`,
        mimeType: mime,
        size: buffer.length,
        createdAt: '2026-10-05T01:00:00.000Z',
      });
      expect(document.objectPath).toMatch(new RegExp(`^${TUTOR_ID}/[a-f0-9-]+\\.${extension}$`));
      expect(auditRecords).toEqual([
        { documentId: DOCUMENT_ID, actorUserId: TUTOR_ID, action: 'UPLOADED' },
      ]);
      expect(lockTutor).toHaveBeenCalledWith(expect.anything(), TUTOR_ID);
    },
  );

  it('accepts the inclusive 5 MiB boundary', async () => {
    const buffer = Buffer.alloc(DOCUMENT_MAX_SIZE_BYTES);
    PDF.copy(buffer);
    const result = await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'CERTIFICATE')
      .attach('file', buffer, { filename: 'certificate.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(result.body).toMatchObject({ size: DOCUMENT_MAX_SIZE_BYTES });
  });

  it.each([
    [Buffer.alloc(0), 'application/pdf'],
    [Buffer.alloc(DOCUMENT_MAX_SIZE_BYTES + 1), 'application/pdf'],
    [Buffer.from('fake PNG'), 'image/png'],
    [PDF, 'image/png'],
    [PNG, 'image/webp'],
    [Buffer.from('<svg/>'), 'image/svg+xml'],
  ])('rejects empty, oversize, unsupported and mismatched files', async (buffer, contentType) => {
    await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'DEGREE')
      .attach('file', buffer, { filename: 'document.pdf', contentType })
      .expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects a missing file, invalid type, unknown fields and multiple files', async () => {
    await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'DEGREE')
      .expect(400);
    await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'PASSPORT')
      .attach('file', PDF, 'degree.pdf')
      .expect(400);
    await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'DEGREE')
      .field('tutorUserId', OTHER_TUTOR_ID)
      .attach('file', PDF, 'degree.pdf')
      .expect(400);
    await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'DEGREE')
      .attach('file', PDF, 'first.pdf')
      .attach('file', PDF, 'second.pdf')
      .expect(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('blocks duplicate pending uploads before storage', async () => {
    findFirst.mockResolvedValue(document);
    const result = await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'DEGREE')
      .attach('file', PDF, { filename: 'degree.pdf', contentType: 'application/pdf' })
      .expect(409);
    expect(result.body).toMatchObject({ code: 'DOCUMENT_PENDING_DUPLICATE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['constraint', 'audit'])(
    'cleans up uploaded storage and rolls back a failed %s save',
    async (failure) => {
      if (failure === 'constraint') {
        createDocument.mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '7.10.0',
          }),
        );
      } else {
        createAudit.mockRejectedValueOnce(new Error('metadata transaction failed'));
      }
      await request(app.getHttpServer())
        .post(TUTOR_BASE)
        .auth('tutor', { type: 'bearer' })
        .field('documentType', 'DEGREE')
        .attach('file', PDF, { filename: 'degree.pdf', contentType: 'application/pdf' })
        .expect(failure === 'constraint' ? 409 : 503);
      expect(auditRecords).toEqual([]);
      expect(document).toEqual(fixture());
      const deletion = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(deletion).toBeDefined();
      if (!deletion) {
        throw new Error('Expected compensating storage deletion');
      }
      const body: unknown = await new Request(...deletion).json();
      expect(body).toEqual({ prefixes: [expect.stringMatching(new RegExp(`^${TUTOR_ID}/`))] });
    },
  );

  it('rejects a public document bucket and sanitizes provider failures', async () => {
    fetchMock.mockResolvedValueOnce(storageResponse({ public: true }));
    await request(app.getHttpServer())
      .post(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .field('documentType', 'DEGREE')
      .attach('file', PDF, { filename: 'degree.pdf', contentType: 'application/pdf' })
      .expect(503);
    expect(createDocument).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(storageResponse({ message: ENVIRONMENT.SUPABASE_SECRET_KEY }, 403));
    const result = await request(app.getHttpServer())
      .get(`${ADMIN_BASE}/${DOCUMENT_ID}/signed-url`)
      .auth('admin', { type: 'bearer' })
      .expect(503);
    expect(JSON.stringify(result.body)).not.toContain(ENVIRONMENT.SUPABASE_SECRET_KEY);
  });

  it('returns a sanitized failure and a reconciliation alert if cleanup is unavailable', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    createAudit.mockRejectedValueOnce(new Error('write unavailable'));
    fetchMock
      .mockResolvedValueOnce(storageResponse({ public: false }))
      .mockResolvedValueOnce(storageResponse({ Key: 'uploaded', Id: 'file-id' }))
      .mockResolvedValueOnce(storageResponse({ message: 'provider-secret-object-path' }, 503));
    try {
      const result = await request(app.getHttpServer())
        .post(TUTOR_BASE)
        .auth('tutor', { type: 'bearer' })
        .field('documentType', 'DEGREE')
        .attach('file', PDF, { filename: 'degree.pdf', contentType: 'application/pdf' })
        .expect(503);
      expect(JSON.stringify(result.body)).not.toContain('provider-secret-object-path');
      expect(auditRecords).toEqual([]);
      expect(document).toEqual(fixture());
      expect(errorLog).toHaveBeenCalledWith(
        'Qualification upload rollback could not remove the new object; storage reconciliation is required',
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('lists only owned safe metadata and maps APPROVED filters to VERIFIED', async () => {
    document = { ...fixture(), reviewStatus: TutorDocumentReviewStatus.VERIFIED };
    findMany.mockResolvedValue([document]);
    const result = await request(app.getHttpServer())
      .get(TUTOR_BASE)
      .query({ status: 'APPROVED' })
      .auth('tutor', { type: 'bearer' })
      .expect(200);
    expect(result.body).toMatchObject({
      items: [
        {
          documentId: DOCUMENT_ID,
          type: 'DEGREE',
          status: 'APPROVED',
          reviewedAt: null,
          rejectionReason: null,
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain('objectPath');
    expect(JSON.stringify(result.body)).not.toContain(ENVIRONMENT.SUPABASE_SECRET_KEY);
    expect(findMany).toHaveBeenCalledWith(
      matchingObject({
        where: matchingObject({
          tutorUserId: TUTOR_ID,
          reviewStatus: 'VERIFIED',
          tutor: { user: { deletedAt: null, accountStatus: 'ACTIVE', role: 'TUTOR' } },
        }),
      }),
    );
  });

  it('uses stable createdAt/id pagination with filter-bound cursors', async () => {
    const older = { ...fixture(), id: '40000000-0000-4000-8000-000000000001' };
    findMany.mockResolvedValueOnce([document, older]).mockResolvedValueOnce([older]);
    const cursor = encodeQualificationCursor(document, QualificationStatus.PENDING);
    const first = await request(app.getHttpServer())
      .get(ADMIN_BASE)
      .query({ limit: 1 })
      .auth('admin', { type: 'bearer' })
      .expect(200);
    expect(first.body).toMatchObject({ items: [{ documentId: DOCUMENT_ID }], nextCursor: cursor });
    const second = await request(app.getHttpServer())
      .get(ADMIN_BASE)
      .query({ limit: 1, cursor })
      .auth('admin', { type: 'bearer' })
      .expect(200);
    expect(second.body).toMatchObject({ items: [{ documentId: older.id }], nextCursor: null });
    expect(findMany).toHaveBeenLastCalledWith(
      matchingObject({
        take: 2,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: matchingObject({
          reviewStatus: 'PENDING',
          OR: [
            { createdAt: { lt: document.createdAt } },
            { createdAt: document.createdAt, id: { lt: DOCUMENT_ID } },
          ],
        }),
      }),
    );
    await request(app.getHttpServer())
      .get(ADMIN_BASE)
      .query({ cursor, status: 'APPROVED' })
      .auth('admin', { type: 'bearer' })
      .expect(400);
  });

  it('defaults the admin queue to PENDING and 20 rows', async () => {
    await request(app.getHttpServer())
      .get(ADMIN_BASE)
      .auth('admin', { type: 'bearer' })
      .expect(200);
    expect(findMany).toHaveBeenCalledWith(
      matchingObject({
        take: 21,
        where: matchingObject({ reviewStatus: 'PENDING' }),
      }),
    );
  });

  it.each([
    { status: 'VERIFIED' },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: 'abc' },
    { cursor: 'bad-cursor' },
    { ownerId: TUTOR_ID },
  ])('rejects invalid queue input %j', async (query) => {
    await request(app.getHttpServer())
      .get(ADMIN_BASE)
      .query(query)
      .auth('admin', { type: 'bearer' })
      .expect(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects invalid status and owner filters on the tutor list', async () => {
    for (const query of [{ status: 'VERIFIED' }, { tutorUserId: OTHER_TUTOR_ID }]) {
      await request(app.getHttpServer())
        .get(TUTOR_BASE)
        .query(query)
        .auth('tutor', { type: 'bearer' })
        .expect(400);
    }
  });

  it('returns minimal admin details with immutable review evidence', async () => {
    document = {
      ...document,
      reviewStatus: TutorDocumentReviewStatus.REJECTED,
      reviewedAt: new Date('2026-10-05T02:00:00.000Z'),
      reviewerUserId: ADMIN_ID,
      rejectionReason: 'Unreadable',
    };
    const result = await request(app.getHttpServer())
      .get(`${ADMIN_BASE}/${DOCUMENT_ID}`)
      .auth('admin', { type: 'bearer' })
      .expect(200);
    expect(result.body).toMatchObject({
      document: { documentId: DOCUMENT_ID, status: 'REJECTED' },
      tutor: { userId: TUTOR_ID, displayName: 'Tutor', verificationStatus: 'PENDING' },
      reviewHistory: [
        {
          status: 'REJECTED',
          reviewedBy: ADMIN_ID,
          reviewedAt: '2026-10-05T02:00:00.000Z',
          reason: 'Unreadable',
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain('objectPath');
    expect(JSON.stringify(result.body)).not.toContain('email');
  });

  it.each(['tutor', 'admin'])('issues audited no-store previews for %s', async (actor) => {
    const result = await request(app.getHttpServer())
      .get(`${actor === 'tutor' ? TUTOR_BASE : ADMIN_BASE}/${DOCUMENT_ID}/signed-url`)
      .auth(actor, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(result.body).toEqual({
      url: `${ENVIRONMENT.SUPABASE_URL}/storage/v1/object/sign/test-documents/preview?token=test`,
      expiresAt: matchingType(String),
    });
    const audit = auditRecords[0];
    expect(audit).toMatchObject({
      documentId: DOCUMENT_ID,
      actorUserId: actor === 'tutor' ? TUTOR_ID : ADMIN_ID,
      action: 'SIGNED_URL_ISSUED',
    });
    expect(audit?.expiresAt?.getTime()).toBe((audit?.createdAt?.getTime() ?? 0) + 300_000);
    const call = fetchMock.mock.calls.find(([url]) => requestUrl(url).includes('/object/sign/'));
    if (!call) {
      throw new Error('Expected signing request');
    }
    const body: unknown = await new Request(...call).json();
    expect(body).toEqual({ expiresIn: 300 });
  });

  it('returns the immutable approval audit note in the admin review history', async () => {
    const reviewedAt = new Date('2026-10-05T02:00:00.000Z');
    document = {
      ...document,
      reviewStatus: TutorDocumentReviewStatus.VERIFIED,
      reviewerUserId: ADMIN_ID,
      reviewedAt,
      auditEvents: [
        {
          actorUserId: ADMIN_ID,
          createdAt: reviewedAt,
          decision: TutorDocumentReviewStatus.VERIFIED,
          reason: 'Credential confirmed',
        },
      ],
    };
    const result = await request(app.getHttpServer())
      .get(`${ADMIN_BASE}/${DOCUMENT_ID}`)
      .auth('admin', { type: 'bearer' })
      .expect(200);
    expect(result.body).toMatchObject({
      reviewHistory: [
        {
          status: 'APPROVED',
          reviewedBy: ADMIN_ID,
          reviewedAt: reviewedAt.toISOString(),
          reason: 'Credential confirmed',
        },
      ],
    });
  });

  it.each(['x', '😀'])('accepts a 500-character %s rejection reason', async (character) => {
    const reason = character.repeat(500);
    await request(app.getHttpServer())
      .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
      .auth('admin', { type: 'bearer' })
      .send({ decision: 'REJECTED', reason })
      .expect(200);
    expect(document.rejectionReason).toBe(reason);
  });

  it('does not return a URL when access auditing fails', async () => {
    createAudit.mockRejectedValueOnce(new Error('audit unavailable'));
    const result = await request(app.getHttpServer())
      .get(`${ADMIN_BASE}/${DOCUMENT_ID}/signed-url`)
      .auth('admin', { type: 'bearer' })
      .expect(503);
    expect(result.body).not.toHaveProperty('url');
    expect(JSON.stringify(result.body)).not.toContain('token=test');
  });

  it('returns 403 for another tutor’s document before requesting storage', async () => {
    document.tutorUserId = OTHER_TUTOR_ID;
    const result = await request(app.getHttpServer())
      .get(`${TUTOR_BASE}/${DOCUMENT_ID}/signed-url`)
      .auth('tutor', { type: 'bearer' })
      .expect(403);
    expect(result.body).toMatchObject({ code: 'DOCUMENT_NOT_OWNED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks ownership in the service before signing after the guard has granted access', async () => {
    findFirst
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce({ ...document, tutorUserId: OTHER_TUTOR_ID });
    await request(app.getHttpServer())
      .get(`${TUTOR_BASE}/${DOCUMENT_ID}/signed-url`)
      .auth('tutor', { type: 'bearer' })
      .expect(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it.each(['APPROVED', 'REJECTED'])(
    'atomically records %s, profile status and one review audit',
    async (decision) => {
      const result = await request(app.getHttpServer())
        .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
        .auth('admin', { type: 'bearer' })
        .send({ decision, reason: '  Reviewed evidence  ' })
        .expect(200);
      const status = decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED';
      expect(updateDocument).toHaveBeenCalledWith(
        matchingObject({
          where: {
            id: DOCUMENT_ID,
            reviewStatus: 'PENDING',
            tutor: { user: { deletedAt: null, accountStatus: 'ACTIVE', role: 'TUTOR' } },
          },
        }),
      );
      expect(updateTutor).toHaveBeenCalledWith({
        where: { userId: TUTOR_ID },
        data: { verificationStatus: status },
        select: { userId: true },
      });
      expect(result.body).toMatchObject({
        documentId: DOCUMENT_ID,
        status: decision,
        reviewedBy: ADMIN_ID,
        tutorVerificationStatus: status,
        reviewedAt: matchingType(String),
      });
      expect(document).toMatchObject({
        reviewStatus: status,
        reviewerUserId: ADMIN_ID,
        reviewedAt: matchingType(Date),
        rejectionReason: decision === 'REJECTED' ? 'Reviewed evidence' : null,
      });
      expect(verificationStatus).toBe(status);
      expect(auditRecords).toEqual([
        {
          documentId: DOCUMENT_ID,
          actorUserId: ADMIN_ID,
          action: 'REVIEWED',
          decision: status,
          reason: 'Reviewed evidence',
          createdAt: document.reviewedAt,
        },
      ]);
      await request(app.getHttpServer())
        .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
        .auth('admin', { type: 'bearer' })
        .send({ decision })
        .expect(decision === 'REJECTED' ? 400 : 409);
      expect(auditRecords).toHaveLength(1);
    },
  );

  it('permits approval without a note and rejects a later rejection', async () => {
    await request(app.getHttpServer())
      .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
      .auth('admin', { type: 'bearer' })
      .send({ decision: 'APPROVED' })
      .expect(200);
    const second = await request(app.getHttpServer())
      .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
      .auth('admin', { type: 'bearer' })
      .send({ decision: 'REJECTED', reason: 'Changed mind' })
      .expect(409);
    expect(second.body).toMatchObject({ code: 'DOCUMENT_ALREADY_REVIEWED' });
    expect(verificationStatus).toBe('VERIFIED');
    expect(auditRecords).toHaveLength(1);
  });

  it.each([
    { decision: 'VERIFIED' },
    { decision: 'REJECTED' },
    { decision: 'REJECTED', reason: '   ' },
    { decision: 'REJECTED', reason: 'x'.repeat(501) },
    { decision: 'APPROVED', reason: null },
    { decision: 'APPROVED', reviewerUserId: TUTOR_ID },
  ])('rejects invalid review input %j', async (body) => {
    await request(app.getHttpServer())
      .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
      .auth('admin', { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it.each(['profile', 'audit'])(
    'rolls back document and profile changes after a %s failure',
    async (failure) => {
      if (failure === 'profile') {
        updateTutor.mockRejectedValueOnce(new Error('profile failed'));
      } else {
        createAudit.mockRejectedValueOnce(new Error('audit failed'));
      }
      await request(app.getHttpServer())
        .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
        .auth('admin', { type: 'bearer' })
        .send({ decision: 'APPROVED' })
        .expect(503);
      expect(document).toEqual(fixture());
      expect(verificationStatus).toBe('PENDING');
      expect(auditRecords).toEqual([]);
    },
  );

  it('allows only one successful contender through the conditional pending update', async () => {
    const results = await Promise.all(
      ['APPROVED', 'REJECTED'].map((decision) =>
        request(app.getHttpServer())
          .patch(`${ADMIN_BASE}/${DOCUMENT_ID}`)
          .auth('admin', { type: 'bearer' })
          .send({ decision, reason: 'Review evidence' }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(auditRecords).toHaveLength(1);
    expect(lockTutor).toHaveBeenCalledTimes(2);
  });

  const routes = [
    { method: 'post', url: TUTOR_BASE, role: 'tutor' },
    { method: 'get', url: TUTOR_BASE, role: 'tutor' },
    { method: 'get', url: `${TUTOR_BASE}/${DOCUMENT_ID}/signed-url`, role: 'tutor' },
    { method: 'get', url: ADMIN_BASE, role: 'admin' },
    { method: 'get', url: `${ADMIN_BASE}/${DOCUMENT_ID}`, role: 'admin' },
    { method: 'get', url: `${ADMIN_BASE}/${DOCUMENT_ID}/signed-url`, role: 'admin' },
    { method: 'patch', url: `${ADMIN_BASE}/${DOCUMENT_ID}`, role: 'admin' },
  ] as const;
  it.each(routes)(
    'authenticates and role-checks $method $url before document queries',
    async ({ method, url, role }) => {
      await request(app.getHttpServer())[method](url).expect(401);
      await request(app.getHttpServer())
        [method](url)
        .auth('invalid', { type: 'bearer' })
        .expect(401);
      await request(app.getHttpServer())
        [method](url)
        .auth(role === 'tutor' ? 'admin' : 'tutor', { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        [method](url)
        .auth('student', { type: 'bearer' })
        .expect(403);
      expect(findFirst).not.toHaveBeenCalled();
      expect(findMany).not.toHaveBeenCalled();
      expect(createDocument).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a revoked session even with a verified token', async () => {
    findSession.mockResolvedValueOnce({
      id: 'tutor',
      userId: TUTOR_ID,
      revokedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      user: {
        id: TUTOR_ID,
        email: 'test@example.test',
        role: Role.TUTOR,
        deletedAt: null,
        accountStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    await request(app.getHttpServer())
      .get(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .expect(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('requires current privacy consent for tutor document operations', async () => {
    findTutorAccount.mockResolvedValueOnce({
      policyVersion: 'old-policy',
      tutorProfile: { userId: TUTOR_ID },
    });
    await request(app.getHttpServer())
      .get(TUTOR_BASE)
      .auth('tutor', { type: 'bearer' })
      .expect(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each(routes.filter(({ url }) => url.includes(DOCUMENT_ID)))(
    'validates UUIDs and missing records for $method $url',
    async ({ method, url, role }) => {
      await request(app.getHttpServer())
        [method](url.replace(DOCUMENT_ID, 'bad-id'))
        .auth(role, { type: 'bearer' })
        .send({ decision: 'APPROVED' })
        .expect(400);
      expect(findFirst).not.toHaveBeenCalled();
      findFirst.mockResolvedValue(null);
      await request(app.getHttpServer())
        [method](url)
        .auth(role, { type: 'bearer' })
        .send({ decision: 'APPROVED' })
        .expect(404);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('publishes all seven secured operations and bounded request/response schemas', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    expect(result.body).toMatchObject({
      paths: {
        [TUTOR_BASE]: {
          post: {
            security: matchingType(Array),
            responses: { '201': matchingType(Object), '409': matchingType(Object) },
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: { additionalProperties: false, required: ['file', 'documentType'] },
                },
              },
            },
          },
          get: { responses: { '200': matchingType(Object) } },
        },
        [`${TUTOR_BASE}/{documentId}/signed-url`]: {
          get: { responses: { '403': matchingType(Object), '404': matchingType(Object) } },
        },
        [ADMIN_BASE]: { get: { security: matchingType(Array) } },
        [`${ADMIN_BASE}/{documentId}`]: {
          get: { security: matchingType(Array) },
          patch: { responses: { '409': matchingType(Object) } },
        },
        [`${ADMIN_BASE}/{documentId}/signed-url`]: {
          get: { security: matchingType(Array), responses: { '503': matchingType(Object) } },
        },
      },
    });
  });
});

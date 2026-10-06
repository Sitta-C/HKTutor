import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { TutorDocumentReviewStatus } from '@generated/prisma/enums';
import {
  QualificationDecision,
  QualificationDocumentType,
  QualificationListQueryDto,
  QualificationQueueQueryDto,
  QualificationStatus,
  ReviewQualificationDto,
  UploadQualificationDto,
} from '@modules/qualification-documents/qualification-documents.dto';
import {
  decodeQualificationCursor,
  encodeQualificationCursor,
  toDocumentResponse,
  toQualificationStatus,
  toReviewStatus,
} from '@modules/qualification-documents/qualification-documents.model';

import type { DocumentMetadata } from '@modules/qualification-documents/qualification-documents.model';

const DOCUMENT: DocumentMetadata = {
  id: '30000000-0000-4000-8000-000000000001',
  tutorUserId: '20000000-0000-4000-8000-000000000001',
  documentType: 'DEGREE',
  originalName: 'degree.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 128,
  reviewStatus: TutorDocumentReviewStatus.PENDING,
  reviewedAt: null,
  reviewerUserId: null,
  rejectionReason: null,
  createdAt: new Date('2026-10-06T08:00:00.000Z'),
};

describe('Qualification document model', () => {
  it.each([
    [TutorDocumentReviewStatus.PENDING, QualificationStatus.PENDING],
    [TutorDocumentReviewStatus.VERIFIED, QualificationStatus.APPROVED],
    [TutorDocumentReviewStatus.REJECTED, QualificationStatus.REJECTED],
  ])('maps database %s to API %s and back', (databaseStatus, apiStatus) => {
    expect(toQualificationStatus(databaseStatus)).toBe(apiStatus);
    expect(toReviewStatus(apiStatus)).toBe(databaseStatus);
  });

  it('maps only safe metadata with UTC timestamps', () => {
    const result = toDocumentResponse(DOCUMENT);
    expect(result).toEqual({
      documentId: DOCUMENT.id,
      type: 'DEGREE',
      status: 'PENDING',
      fileName: 'degree.pdf',
      mimeType: 'application/pdf',
      size: 128,
      createdAt: '2026-10-06T08:00:00.000Z',
      reviewedAt: null,
      rejectionReason: null,
    });
    expect(result).not.toHaveProperty('tutorUserId');
    expect(result).not.toHaveProperty('reviewerUserId');
    expect(result).not.toHaveProperty('objectPath');
  });

  it('round-trips stable timestamp/UUID cursors bound to status', () => {
    const cursor = encodeQualificationCursor(DOCUMENT, QualificationStatus.PENDING);
    expect(decodeQualificationCursor(cursor, QualificationStatus.PENDING)).toEqual({
      id: DOCUMENT.id,
      createdAt: DOCUMENT.createdAt.toISOString(),
      status: QualificationStatus.PENDING,
    });
    expect(() => decodeQualificationCursor(cursor, QualificationStatus.APPROVED)).toThrow(
      BadRequestException,
    );
  });

  it.each(['not json', '%bad', '', 'x'.repeat(513)])('rejects malformed cursors', (cursor) => {
    expect(() => decodeQualificationCursor(cursor, QualificationStatus.PENDING)).toThrow(
      BadRequestException,
    );
  });

  it.each([
    null,
    {},
    { id: 'bad', createdAt: DOCUMENT.createdAt.toISOString(), status: 'PENDING' },
    { id: DOCUMENT.id, createdAt: 'not-a-date', status: 'PENDING' },
    { id: DOCUMENT.id, createdAt: '2026-10-06', status: 'PENDING' },
    {
      id: DOCUMENT.id,
      createdAt: DOCUMENT.createdAt.toISOString(),
      status: 'PENDING',
      extra: true,
    },
  ])('rejects structurally invalid cursor data', (value) => {
    const cursor = Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(() => decodeQualificationCursor(cursor, QualificationStatus.PENDING)).toThrow(
      BadRequestException,
    );
  });
});

describe('Qualification DTOs', () => {
  it.each(Object.values(QualificationDocumentType))(
    'accepts upload type %s',
    async (documentType) => {
      expect(
        await validate(plainToInstance(UploadQualificationDto, { documentType })),
      ).toHaveLength(0);
    },
  );

  it.each([undefined, 'IDENTITY', '', 'degree', ['DEGREE'], 1])(
    'rejects unsupported upload types',
    async (documentType) => {
      expect(
        await validate(plainToInstance(UploadQualificationDto, { documentType })),
      ).not.toHaveLength(0);
    },
  );

  it.each(Object.values(QualificationStatus))('accepts status %s', async (status) => {
    expect(await validate(plainToInstance(QualificationListQueryDto, { status }))).toHaveLength(0);
  });

  it.each(['VERIFIED', '', 'unknown', ['PENDING'], 1])(
    'rejects invalid status filters',
    async (status) => {
      expect(
        await validate(plainToInstance(QualificationListQueryDto, { status })),
      ).not.toHaveLength(0);
    },
  );

  it.each(['1', '20', '100'])('transforms valid queue size %s', async (limit) => {
    const dto = plainToInstance(QualificationQueueQueryDto, { limit });
    expect(dto.limit).toBe(Number(limit));
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['0', '101', '1.5', 'abc', '', '-1'])('rejects invalid queue size %s', async (limit) => {
    expect(await validate(plainToInstance(QualificationQueueQueryDto, { limit }))).not.toHaveLength(
      0,
    );
  });

  it('trims a required rejection reason and permits an optional approval note', async () => {
    const rejected = plainToInstance(ReviewQualificationDto, {
      decision: QualificationDecision.REJECTED,
      reason: '  Unreadable  ',
    });
    expect(rejected.reason).toBe('Unreadable');
    expect(await validate(rejected)).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ReviewQualificationDto, { decision: QualificationDecision.APPROVED }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ReviewQualificationDto, {
          decision: QualificationDecision.APPROVED,
          reason: 'Checked',
        }),
      ),
    ).toHaveLength(0);
  });

  it.each([undefined, '', '  ', 'x'.repeat(501), 42])(
    'rejects an invalid rejection reason',
    async (reason) => {
      expect(
        await validate(plainToInstance(ReviewQualificationDto, { decision: 'REJECTED', reason })),
      ).not.toHaveLength(0);
    },
  );

  it('rejects unknown writable fields', async () => {
    const dto = plainToInstance(ReviewQualificationDto, {
      decision: 'APPROVED',
      reviewerUserId: DOCUMENT.tutorUserId,
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(
      0,
    );
  });
});

import { BadRequestException } from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';
import { TutorDocumentReviewStatus } from '@generated/prisma/enums';
import { QualificationStatus } from '@modules/qualification-documents/qualification-documents.dto';

import type { Prisma } from '@generated/prisma/client';
import type {
  QualificationDocumentResponseDto,
  QualificationListItemResponseDto,
} from '@modules/qualification-documents/qualification-documents.swagger';

export const DOCUMENT_SELECT = {
  id: true,
  tutorUserId: true,
  documentType: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  reviewStatus: true,
  reviewerUserId: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
} satisfies Prisma.TutorDocumentSelect;

export const ACTIVE_TUTOR_WHERE = {
  user: { deletedAt: null, accountStatus: 'ACTIVE', role: 'TUTOR' },
} satisfies Prisma.TutorProfileWhereInput;

export const DOCUMENT_OWNERSHIP_ERRORS = {
  foreignOwner: { code: 'DOCUMENT_NOT_OWNED', message: 'This document belongs to another tutor' },
  missing: { code: 'DOCUMENT_NOT_FOUND', message: 'Qualification document not found' },
} as const;

export type DocumentMetadata = Prisma.TutorDocumentGetPayload<{
  select: typeof DOCUMENT_SELECT;
}>;

export function toQualificationStatus(status: TutorDocumentReviewStatus): QualificationStatus {
  switch (status) {
    case TutorDocumentReviewStatus.PENDING:
      return QualificationStatus.PENDING;
    case TutorDocumentReviewStatus.VERIFIED:
      return QualificationStatus.APPROVED;
    case TutorDocumentReviewStatus.REJECTED:
      return QualificationStatus.REJECTED;
  }
}

export function toReviewStatus(status: QualificationStatus): TutorDocumentReviewStatus {
  switch (status) {
    case QualificationStatus.PENDING:
      return TutorDocumentReviewStatus.PENDING;
    case QualificationStatus.APPROVED:
      return TutorDocumentReviewStatus.VERIFIED;
    case QualificationStatus.REJECTED:
      return TutorDocumentReviewStatus.REJECTED;
  }
}

export function toDocumentResponse(document: DocumentMetadata): QualificationDocumentResponseDto {
  return {
    documentId: document.id,
    type: document.documentType,
    status: toQualificationStatus(document.reviewStatus),
    fileName: document.originalName,
    mimeType: document.mimeType,
    size: document.sizeBytes,
    createdAt: document.createdAt.toISOString(),
    reviewedAt: document.reviewedAt?.toISOString() ?? null,
    rejectionReason: document.rejectionReason,
  };
}

export function toListItemResponse(document: DocumentMetadata): QualificationListItemResponseDto {
  return {
    documentId: document.id,
    type: document.documentType,
    status: toQualificationStatus(document.reviewStatus),
    reviewedAt: document.reviewedAt?.toISOString() ?? null,
    rejectionReason: document.rejectionReason,
  };
}

export interface QualificationCursor {
  id: string;
  createdAt: string;
  status: QualificationStatus;
}

export function encodeQualificationCursor(
  document: DocumentMetadata,
  status: QualificationStatus,
): string {
  return Buffer.from(
    JSON.stringify({ id: document.id, createdAt: document.createdAt.toISOString(), status }),
  ).toString('base64url');
}

export function decodeQualificationCursor(
  cursor: string,
  status: QualificationStatus,
): QualificationCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 512) {
      throw new Error('Invalid cursor');
    }
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      !('createdAt' in value) ||
      !('status' in value) ||
      Object.keys(value).length !== 3 ||
      !isUuid(value.id) ||
      typeof value.createdAt !== 'string' ||
      new Date(value.createdAt).toISOString() !== value.createdAt ||
      value.status !== status
    ) {
      throw new Error('Invalid cursor');
    }
    return { id: value.id, createdAt: value.createdAt, status };
  } catch {
    throw new BadRequestException('Invalid qualification queue cursor');
  }
}

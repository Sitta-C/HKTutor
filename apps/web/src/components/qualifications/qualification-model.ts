import { ApiError } from '@/lib/api/error';

import type { QualificationDocumentType, ReviewQualificationPayload } from '@/lib/api/types';

export const QUALIFICATION_MAX_BYTES = 5 * 1024 * 1024;

export type QualificationFileError = 'empty' | 'type' | 'size' | null;

export function validateQualificationFile(
  file: Pick<File, 'size' | 'type'>,
): QualificationFileError {
  if (file.size === 0) {
    return 'empty';
  }
  if (file.size > QUALIFICATION_MAX_BYTES) {
    return 'size';
  }
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
    return 'type';
  }
  return null;
}

export function validateReviewDecision(
  decision: 'APPROVED' | 'REJECTED',
  reason: string,
): ReviewQualificationPayload | null {
  const trimmed = reason.trim();
  if (trimmed.length > 500 || (decision === 'REJECTED' && trimmed.length === 0)) {
    return null;
  }
  return decision === 'REJECTED'
    ? { decision, reason: trimmed }
    : { decision, ...(trimmed ? { reason: trimmed } : {}) };
}

export function signedUrlIsExpired(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= now + 5000;
}

export function qualificationErrorKind(
  error: unknown,
): 'denied' | 'conflict' | 'missing' | 'unavailable' {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return 'denied';
    }
    if (error.status === 409) {
      return 'conflict';
    }
    if (error.status === 404) {
      return 'missing';
    }
  }
  return 'unavailable';
}

export function canUploadType(
  documents: { type: string; status: string }[],
  type: QualificationDocumentType,
): boolean {
  return !documents.some((document) => document.type === type && document.status === 'PENDING');
}

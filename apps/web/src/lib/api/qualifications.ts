'use client';

import { authenticatedFetch, authenticatedUpload } from '@/lib/api/client';

import type {
  QualificationDetailResponse,
  QualificationDocumentType,
  QualificationListResponse,
  QualificationQueueResponse,
  QualificationReviewResponse,
  QualificationSignedUrlResponse,
  QualificationStatus,
  QualificationUploadResponse,
  ReviewQualificationPayload,
} from '@/lib/api/types';

const TUTOR_PATH = '/tutors/me/qualification-documents';
const ADMIN_PATH = '/admin/tutor-verifications';

export function uploadQualification(
  file: File,
  documentType: QualificationDocumentType,
  onProgress: (percent: number) => void,
): Promise<QualificationUploadResponse> {
  const body = new FormData();
  body.append('file', file);
  body.append('documentType', documentType);
  return authenticatedUpload(TUTOR_PATH, body, onProgress);
}

export function listMyQualifications(
  status?: QualificationStatus,
): Promise<QualificationListResponse> {
  const query = new URLSearchParams();
  if (status) {
    query.set('status', status);
  }
  return authenticatedFetch(`${TUTOR_PATH}${query.size ? `?${query}` : ''}`);
}

export function getMyQualificationSignedUrl(
  documentId: string,
): Promise<QualificationSignedUrlResponse> {
  return authenticatedFetch(`${TUTOR_PATH}/${encodeURIComponent(documentId)}/signed-url`);
}

export function listAdminVerifications(
  status: QualificationStatus,
  cursor?: string,
): Promise<QualificationQueueResponse> {
  const query = new URLSearchParams({ status, limit: '20' });
  if (cursor) {
    query.set('cursor', cursor);
  }
  return authenticatedFetch(`${ADMIN_PATH}?${query}`);
}

export function getAdminVerification(documentId: string): Promise<QualificationDetailResponse> {
  return authenticatedFetch(`${ADMIN_PATH}/${encodeURIComponent(documentId)}`);
}

export function getAdminVerificationSignedUrl(
  documentId: string,
): Promise<QualificationSignedUrlResponse> {
  return authenticatedFetch(`${ADMIN_PATH}/${encodeURIComponent(documentId)}/signed-url`);
}

export function reviewAdminVerification(
  documentId: string,
  payload: ReviewQualificationPayload,
): Promise<QualificationReviewResponse> {
  return authenticatedFetch(`${ADMIN_PATH}/${encodeURIComponent(documentId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export type QualificationListItem = QualificationListResponse['items'][number];

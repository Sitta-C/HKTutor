'use client';

import { apiFetch } from '@/lib/api/client';

import type {
  GradeLevelOption,
  PublicAvailabilityQuery,
  PublicAvailabilitySlot,
  PublicTutorDetail,
  SubjectOption,
  TutorReviewsResponse,
  TutorSearchQuery,
  TutorSearchResponse,
} from '@/lib/api/types';

interface CatalogResponse<T> {
  items: T[];
}

export const TUTOR_SEARCH_PAGE_SIZE = 10;

export async function getSubjectCatalog(): Promise<SubjectOption[]> {
  const response = await apiFetch<CatalogResponse<SubjectOption>>('/subjects');
  return response.items.filter((item) => item.active);
}

export async function getGradeLevelCatalog(): Promise<GradeLevelOption[]> {
  const response = await apiFetch<CatalogResponse<GradeLevelOption>>('/grade-levels');
  return response.items.filter((item) => item.active);
}

export function searchTutors(
  query: TutorSearchQuery = {},
  requestInit: Pick<RequestInit, 'signal'> = {},
): Promise<TutorSearchResponse> {
  const params = new URLSearchParams();

  if (query.priority) params.set('priority', query.priority);
  if (query.subject) params.set('subject', query.subject);
  if (query.grade) params.set('grade', query.grade);
  if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));
  if (query.minimumRating !== undefined) {
    params.set('minimumRating', String(query.minimumRating));
  }
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));

  const queryString = params.toString();
  return apiFetch<TutorSearchResponse>(
    `/tutors${queryString ? `?${queryString}` : ''}`,
    requestInit,
  );
}

export function getPublicTutor(
  tutorId: string,
  requestInit: Pick<RequestInit, 'signal'> = {},
): Promise<PublicTutorDetail> {
  return apiFetch(`/tutors/${encodeURIComponent(tutorId)}`, requestInit);
}

export function getPublicTutorAvailability(
  tutorId: string,
  query: PublicAvailabilityQuery = {},
  requestInit: Pick<RequestInit, 'signal'> = {},
): Promise<PublicAvailabilitySlot[]> {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', toIsoString(query.from));
  if (query.to !== undefined) params.set('to', toIsoString(query.to));

  const queryString = params.toString();
  return apiFetch<PublicAvailabilitySlot[]>(
    `/tutors/${encodeURIComponent(tutorId)}/availability${queryString ? `?${queryString}` : ''}`,
    requestInit,
  );
}

export function getPublicTutorReviews(
  tutorId: string,
  query: { cursor?: string; limit?: number } = {},
  requestInit: Pick<RequestInit, 'signal'> = {},
): Promise<TutorReviewsResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);

  const queryString = params.toString();
  return apiFetch<TutorReviewsResponse>(
    `/tutors/${encodeURIComponent(tutorId)}/reviews${queryString ? `?${queryString}` : ''}`,
    requestInit,
  );
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

'use client';

import { apiFetch } from '@/lib/api/client';

import type {
  GradeLevelOption,
  PublicAvailabilityQuery,
  PublicAvailabilitySlot,
  PublicTutorDetail,
  SubjectOption,
  TutorSearchQuery,
  TutorSearchResult,
} from '@/lib/api/types';

interface CatalogResponse<T> {
  items: T[];
}

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
): Promise<TutorSearchResult[]> {
  const params = new URLSearchParams();

  if (query.subject) params.set('subject', query.subject);
  if (query.grade) params.set('grade', query.grade);
  if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));
  if (query.minimumRating !== undefined) {
    params.set('minimumRating', String(query.minimumRating));
  }

  const queryString = params.toString();
  return apiFetch<TutorSearchResult[]>(
    `/tutors${queryString ? `?${queryString}` : ''}`,
    requestInit,
  );
}

export function getPublicTutor(tutorId: string): Promise<PublicTutorDetail> {
  return apiFetch(`/tutors/${encodeURIComponent(tutorId)}`);
}

export function getPublicTutorAvailability(
  tutorId: string,
  query: PublicAvailabilityQuery = {},
): Promise<PublicAvailabilitySlot[]> {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', toIsoString(query.from));
  if (query.to !== undefined) params.set('to', toIsoString(query.to));

  const queryString = params.toString();
  return apiFetch<PublicAvailabilitySlot[]>(
    `/tutors/${encodeURIComponent(tutorId)}/availability${queryString ? `?${queryString}` : ''}`,
  );
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

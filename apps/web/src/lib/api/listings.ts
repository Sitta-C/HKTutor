'use client';

import { apiFetch, authenticatedFetch } from '@/lib/api/client';

import type {
  GradeLevelOption,
  ListingPublicationStatus,
  SaveTeachingListingPayload,
  SubjectOption,
  TeachingListing,
} from '@/lib/api/types';

interface CatalogResponse<T> {
  items: T[];
}

interface ListingCollectionResponse {
  items: TeachingListing[];
  total: number;
}

export async function getListingCatalogs(): Promise<{
  subjects: SubjectOption[];
  gradeLevels: GradeLevelOption[];
}> {
  const [subjects, gradeLevels] = await Promise.all([
    apiFetch<CatalogResponse<SubjectOption>>('/catalogs/subjects'),
    apiFetch<CatalogResponse<GradeLevelOption>>('/catalogs/grade-levels'),
  ]);

  return {
    subjects: subjects.items.filter((item) => item.active),
    gradeLevels: gradeLevels.items.filter((item) => item.active),
  };
}

export async function getTutorListings(
  publicationStatus?: ListingPublicationStatus,
): Promise<TeachingListing[]> {
  const query = publicationStatus
    ? `?${new URLSearchParams({ publicationStatus }).toString()}`
    : '';
  const response = await authenticatedFetch<TeachingListing[] | ListingCollectionResponse>(
    `/tutors/me/listings${query}`,
  );

  return Array.isArray(response) ? response : response.items;
}

export function getTutorListing(listingId: string): Promise<TeachingListing> {
  return authenticatedFetch<TeachingListing>(
    `/tutors/me/listings/${encodeURIComponent(listingId)}`,
  );
}

export async function createTutorListing(payload: SaveTeachingListingPayload): Promise<string> {
  const response = await authenticatedFetch<string | TeachingListing>('/tutors/me/listings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return typeof response === 'string' ? response : response.listingId;
}

export function updateTutorListing(
  listingId: string,
  payload: SaveTeachingListingPayload,
): Promise<TeachingListing> {
  return authenticatedFetch<TeachingListing>(
    `/tutors/me/listings/${encodeURIComponent(listingId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

export function publishTutorListing(listingId: string): Promise<void> {
  return authenticatedFetch<void>(`/tutors/me/listings/${encodeURIComponent(listingId)}/publish`, {
    method: 'POST',
  });
}

export function archiveTutorListing(listingId: string): Promise<TeachingListing> {
  return updateTutorListingStatus(listingId, 'ARCHIVED');
}

export function restoreTutorListing(listingId: string): Promise<TeachingListing> {
  return updateTutorListingStatus(listingId, 'DRAFT');
}

export function updateTutorListingStatus(
  listingId: string,
  publicationStatus: Extract<ListingPublicationStatus, 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>,
): Promise<TeachingListing> {
  return authenticatedFetch<TeachingListing>(
    `/tutors/me/listings/${encodeURIComponent(listingId)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ publicationStatus }),
    },
  );
}

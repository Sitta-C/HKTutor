'use client';

import { apiFetch, authenticatedFetch } from '@/lib/api/client';

import type {
  GradeLevelOption,
  ListingPublicationStatus,
  PatchTeachingListingPayload,
  SaveTeachingListingPayload,
  SubjectOption,
  TeachingListing,
} from '@/lib/api/types';

interface CatalogResponse<T> {
  items: T[];
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

export function getTutorListings(
  publicationStatus?: ListingPublicationStatus,
): Promise<TeachingListing[]> {
  const query = publicationStatus
    ? `?${new URLSearchParams({ publicationStatus }).toString()}`
    : '';
  return authenticatedFetch(`/tutors/me/listings${query}`);
}

export function getTutorListing(listingId: string): Promise<TeachingListing> {
  return authenticatedFetch(`/tutors/me/listings/${encodeURIComponent(listingId)}`);
}

export async function createTutorListing(payload: SaveTeachingListingPayload): Promise<string> {
  const listing = await authenticatedFetch<TeachingListing>('/tutors/me/listings', {
    body: JSON.stringify(payload),
    method: 'POST',
  });

  return listing.id;
}

export function updateTutorListing(
  listingId: string,
  payload: PatchTeachingListingPayload,
): Promise<TeachingListing> {
  return authenticatedFetch(`/tutors/me/listings/${encodeURIComponent(listingId)}`, {
    body: JSON.stringify(payload),
    method: 'PATCH',
  });
}

export function publishTutorListing(listingId: string): Promise<TeachingListing> {
  return authenticatedFetch(`/tutors/me/listings/${encodeURIComponent(listingId)}/publish`, {
    method: 'POST',
  });
}

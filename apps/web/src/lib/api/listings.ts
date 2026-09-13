'use client';

import { authenticatedFetch } from '@/lib/api/client';
import { getGradeLevelCatalog, getSubjectCatalog } from '@/lib/api/tutors';

import type {
  GradeLevelOption,
  ListingPublicationStatus,
  PatchTeachingListingPayload,
  SaveTeachingListingPayload,
  SubjectOption,
  TeachingListing,
} from '@/lib/api/types';

export async function getListingCatalogs(): Promise<{
  subjects: SubjectOption[];
  gradeLevels: GradeLevelOption[];
}> {
  const [subjects, gradeLevels] = await Promise.all([getSubjectCatalog(), getGradeLevelCatalog()]);

  return { subjects, gradeLevels };
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

export function archiveTutorListing(listingId: string): Promise<TeachingListing> {
  return updateTutorListingStatus(listingId, 'ARCHIVED');
}

export function restoreTutorListing(listingId: string): Promise<TeachingListing> {
  return updateTutorListingStatus(listingId, 'DRAFT');
}

export function updateTutorListingStatus(
  listingId: string,
  publicationStatus: ListingPublicationStatus,
): Promise<TeachingListing> {
  return authenticatedFetch(`/tutors/me/listings/${encodeURIComponent(listingId)}/status`, {
    body: JSON.stringify({ publicationStatus }),
    method: 'PATCH',
  });
}

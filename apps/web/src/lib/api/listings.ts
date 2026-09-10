'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  ListingPublicationStatus,
  PatchTeachingListingPayload,
  SaveTeachingListingPayload,
  TeachingListing,
} from '@/lib/api/types';

export function getMyListings(
  publicationStatus?: ListingPublicationStatus,
): Promise<TeachingListing[]> {
  const query = publicationStatus
    ? `?publicationStatus=${encodeURIComponent(publicationStatus)}`
    : '';
  return authenticatedFetch(`/tutors/me/listings${query}`);
}

export function getMyListing(listingId: string): Promise<TeachingListing> {
  return authenticatedFetch(`/tutors/me/listings/${encodeURIComponent(listingId)}`);
}

export function createTeachingListing(
  payload: SaveTeachingListingPayload,
): Promise<TeachingListing> {
  return authenticatedFetch('/tutors/me/listings', {
    body: JSON.stringify(payload),
    method: 'POST',
  });
}

export function patchTeachingListing(
  listingId: string,
  payload: PatchTeachingListingPayload,
): Promise<TeachingListing> {
  return authenticatedFetch(`/tutors/me/listings/${encodeURIComponent(listingId)}`, {
    body: JSON.stringify(payload),
    method: 'PATCH',
  });
}

export function publishTeachingListing(listingId: string): Promise<TeachingListing> {
  return authenticatedFetch(`/tutors/me/listings/${encodeURIComponent(listingId)}/publish`, {
    method: 'POST',
  });
}

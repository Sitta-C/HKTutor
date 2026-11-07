import { buildTutorRatingSummary } from '@/components/tutors/tutor-rating-model';

import type { TutorRatingSummary } from '@/components/tutors/tutor-rating-model';
import type {
  PublicAvailabilitySlot,
  PublicTeachingListing,
  PublicTutorProfile,
  TutorComparisonSelection,
} from '@/lib/api/types';

/** The six compared attributes, in table row order (US10-1). */
export const COMPARISON_ATTRIBUTES = [
  'price',
  'subject',
  'rating',
  'reviews',
  'experience',
  'availability',
] as const;

export type ComparisonAttribute = (typeof COMPARISON_ATTRIBUTES)[number];

export interface ComparisonAvailability {
  startAtUtc: string;
  endAtUtc: string;
}

/**
 * One selected tutor course, projected from the public profile/listing/availability responses.
 * Only the fields the comparison shows are copied; bio, course description and any field the
 * public API adds later never reach the comparison view. `null` means the public value is
 * missing or malformed and is shown as unavailable rather than as a fabricated value.
 */
export interface TutorComparisonEntry {
  tutorId: string;
  listingId: string;
  displayName: string;
  subject: string | null;
  grade: string | null;
  pricePerHour: number | null;
  rating: TutorRatingSummary;
  experienceYears: number | null;
  nextAvailability: ComparisonAvailability | null;
}

export function buildTutorComparisonEntry(
  choice: TutorComparisonSelection,
  tutor: PublicTutorProfile,
  listing: PublicTeachingListing,
  nextSlot: PublicAvailabilitySlot | null,
): TutorComparisonEntry {
  return {
    tutorId: choice.tutorId,
    listingId: choice.listingId,
    displayName: tutor.displayName.trim(),
    subject: publicText(listing.subject),
    grade: publicText(listing.grade),
    pricePerHour: publicPrice(listing.pricePerHour),
    rating: buildTutorRatingSummary(tutor.ratingAverage, tutor.reviewCount),
    experienceYears: publicExperience(tutor.experienceYears),
    nextAvailability: nextSlot && { startAtUtc: nextSlot.startAtUtc, endAtUtc: nextSlot.endAtUtc },
  };
}

function publicText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// Listings are published with a positive hourly price; anything else is not a comparable price.
function publicPrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function publicExperience(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

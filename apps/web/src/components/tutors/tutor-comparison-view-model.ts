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
 * public API adds later never reach the comparison view.
 */
export interface TutorComparisonEntry {
  tutorId: string;
  listingId: string;
  displayName: string;
  subject: string;
  grade: string;
  pricePerHour: number;
  rating: TutorRatingSummary;
  experienceYears: number;
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
    displayName: tutor.displayName,
    subject: listing.subject,
    grade: listing.grade,
    pricePerHour: listing.pricePerHour,
    rating: buildTutorRatingSummary(tutor.ratingAverage, tutor.reviewCount),
    experienceYears: tutor.experienceYears,
    nextAvailability: nextSlot && { startAtUtc: nextSlot.startAtUtc, endAtUtc: nextSlot.endAtUtc },
  };
}

import { buildTutorRatingSummary } from '@/components/tutors/tutor-rating-model';

import type { ComparisonColumn } from '@/components/tutors/tutor-comparison-model';
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

/**
 * A comparison column keyed by the selected tutor ID. The key stays the same while the column
 * loads, fails or becomes ready, and when the tutor's course is replaced, so the table keeps the
 * tutor in place. Loading, unavailable and error columns carry no tutor or course metadata.
 */
export type TutorComparisonViewColumn =
  | { tutorId: string; listingId: string; state: 'loading' | 'unavailable' | 'error' }
  | { tutorId: string; listingId: string; state: 'ready'; entry: TutorComparisonEntry };

/** Builds the comparison view in selection order; no comparison data is stored or persisted. */
export function buildTutorComparisonView(columns: ComparisonColumn[]): TutorComparisonViewColumn[] {
  const seen = new Set<string>();
  const view: TutorComparisonViewColumn[] = [];
  for (const column of columns) {
    const { tutorId, listingId } = column.choice;
    // One column per tutor; a duplicated tutor would break stable keys and column alignment.
    if (seen.has(tutorId)) {
      continue;
    }
    seen.add(tutorId);
    if (column.state !== 'ready') {
      view.push({ tutorId, listingId, state: column.state });
      continue;
    }
    // Defence in depth: never show a profile or course other than the one selected.
    if (column.tutor.tutorId !== tutorId || column.listing.listingId !== listingId) {
      view.push({ tutorId, listingId, state: 'unavailable' });
      continue;
    }
    view.push({
      tutorId,
      listingId,
      state: 'ready',
      entry: buildTutorComparisonEntry(
        column.choice,
        column.tutor,
        column.listing,
        column.nextSlot,
      ),
    });
  }
  return view;
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

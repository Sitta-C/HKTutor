import { ApiError } from '@/lib/api/error';

import type { BookingReview, BookingStatus } from '@/lib/api/types';

export const REVIEW_RATING_FIELDS = ['clarity', 'punctuality', 'preparation'] as const;
export type ReviewRatingField = (typeof REVIEW_RATING_FIELDS)[number];

export const REVIEW_FEEDBACK_MAX_LENGTH = 1000;

/** Matches the API's Unicode-code-point count, not UTF-16 `.length`. */
export function reviewFeedbackLength(feedback: string): number {
  return Array.from(feedback.trim()).length;
}

export function isValidReviewRating(value: number | null): boolean {
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function canSubmitReview(fields: {
  clarity: number | null;
  punctuality: number | null;
  preparation: number | null;
  feedback: string;
}): boolean {
  const length = reviewFeedbackLength(fields.feedback);
  return (
    isValidReviewRating(fields.clarity) &&
    isValidReviewRating(fields.punctuality) &&
    isValidReviewRating(fields.preparation) &&
    length > 0 &&
    length <= REVIEW_FEEDBACK_MAX_LENGTH
  );
}

/** Eligibility is booking-status-only; ownership and auth are already enforced by the API. */
export function reviewEligibility(
  status: BookingStatus,
  review: BookingReview | null,
): 'locked' | 'ready' | 'saved' {
  if (review) {
    return 'saved';
  }
  return status === 'COMPLETED' ? 'ready' : 'locked';
}

export type ReviewSubmitOutcome =
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'validation'
  | 'alreadyExists'
  | 'notCompleted'
  | 'uncertain';

function reviewErrorCode(error: ApiError): string | undefined {
  const details = error.details;
  return details !== null && typeof details === 'object' && 'code' in details
    ? (details as { code?: unknown }).code?.toString()
    : undefined;
}

/**
 * A 5xx or network failure is uncertain: the write may have landed before the response was lost,
 * so the caller must reconcile with a GET before allowing another manual submission.
 */
export function reviewSubmitOutcome(error: unknown): ReviewSubmitOutcome {
  if (!(error instanceof ApiError) || error.status >= 500) {
    return 'uncertain';
  }
  if (error.status === 401) {
    return 'unauthenticated';
  }
  if (error.status === 403) {
    return 'forbidden';
  }
  if (error.status === 404) {
    return 'notFound';
  }
  if (error.status === 409) {
    return reviewErrorCode(error) === 'REVIEW_ALREADY_EXISTS' ? 'alreadyExists' : 'notCompleted';
  }
  return 'validation';
}

/**
 * Pure decision logic for the tutor booking inbox.
 *
 * The web test runner executes in a node environment and renders no React tree, so the inbox keeps
 * its status rules, failure mapping and list updates here where they can be unit-tested.
 */

import { ApiError } from '@/lib/api/error';

import type { TutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import type {
  BookingStatus,
  TutorBookingActionResult,
  TutorBookingView,
  TutorBookingsQuery,
} from '@/lib/api/types';

/** Mirrors MAX_TUTOR_ACTION_TEXT_LENGTH in the API DTO; longer text is rejected with 400. */
export const MAX_BOOKING_DECISION_TEXT_LENGTH = 500;

export const TUTOR_INBOX_PAGE_SIZE = 10;

export type TutorBookingDecision = 'CONFIRM' | 'REJECT';

export type TutorInboxFilter = 'ALL' | BookingStatus;

/** Same order as the student booking list so one status bar reads the same for both roles. */
export const TUTOR_INBOX_FILTERS: readonly TutorInboxFilter[] = [
  'ALL',
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
];

/** The inbox opens on the requests still waiting for a reply, whatever the filter order is. */
export const DEFAULT_TUTOR_INBOX_FILTER: TutorInboxFilter = 'PENDING';

/**
 * How a failed confirm or reject should be presented. A stale view must be reloaded before the
 * tutor acts again, so the server stays the only source of the booking status.
 */
export type TutorBookingDecisionFailure =
  'AUTH' | 'MISSING' | 'OWNERSHIP' | 'STALE' | 'UNKNOWN' | 'VALIDATION';

export interface TutorBookingDecisionError {
  kind: TutorBookingDecisionFailure;
  message: string;
  requiresRefresh: boolean;
}

export function toTutorBookingsQuery(
  filter: TutorInboxFilter,
  page: number,
): Required<Pick<TutorBookingsQuery, 'page' | 'pageSize'>> & TutorBookingsQuery {
  return {
    ...(filter === 'ALL' ? {} : { status: filter }),
    page,
    pageSize: TUTOR_INBOX_PAGE_SIZE,
  };
}

export function countInboxPages(total: number): number {
  return Math.max(1, Math.ceil(total / TUTOR_INBOX_PAGE_SIZE));
}

/** Only a pending booking can be confirmed or rejected, exactly as the API enforces. */
export function isDecidableBooking(booking: Pick<TutorBookingView, 'status'>): boolean {
  return booking.status === 'PENDING';
}

/** Applies the server-returned status only; the inbox never guesses a transition optimistically. */
export function applyTutorBookingDecision(
  items: readonly TutorBookingView[],
  result: TutorBookingActionResult,
): TutorBookingView[] {
  return items.map((item) =>
    item.id === result.bookingId ? { ...item, status: result.status } : item,
  );
}

/**
 * Keeps the filtered count honest after a decision: the acted-on row stays visible with its new
 * status, but it no longer belongs to a single-status view.
 */
export function adjustFilteredTotal(
  total: number,
  filter: TutorInboxFilter,
  status: BookingStatus,
): number {
  if (filter === 'ALL' || filter === status) return total;
  return Math.max(0, total - 1);
}

export interface InboxSyncPlan {
  total: number | null;
  page: number;
  needsReload: boolean;
}

/**
 * A decision that moves a booking out of a single-status view shrinks the server result set, so
 * every later page shifts by one and paging on would skip the booking that moved up. The inbox
 * refetches the current page instead, clamped into the page count the smaller total allows.
 */
export function planInboxSyncAfterDecision(input: {
  filter: TutorInboxFilter;
  page: number;
  status: BookingStatus;
  total: number | null;
}): InboxSyncPlan {
  const total =
    input.total === null ? null : adjustFilteredTotal(input.total, input.filter, input.status);
  const leavesView = input.filter !== 'ALL' && input.filter !== input.status;

  if (!leavesView || total === null) {
    return { total, page: input.page, needsReload: false };
  }

  return { total, page: Math.min(input.page, countInboxPages(total)), needsReload: true };
}

export function getStudentLabel(
  booking: Pick<TutorBookingView, 'student'>,
  copy: TutorBookingInboxCopy,
): string {
  return booking.student.nickname?.trim() || copy.unknownStudent;
}

export function describeDecisionSuccess(
  result: TutorBookingActionResult,
  copy: TutorBookingInboxCopy,
): string {
  if (result.status === 'CONFIRMED') return copy.confirmSuccess;
  return result.slotStatus === 'AVAILABLE'
    ? copy.rejectSuccessSlotOpen
    : copy.rejectSuccessSlotHeld;
}

export function validateDecisionText(value: string, copy: TutorBookingInboxCopy): string | null {
  return value.trim().length > MAX_BOOKING_DECISION_TEXT_LENGTH
    ? copy.textTooLong.replace('{max}', String(MAX_BOOKING_DECISION_TEXT_LENGTH))
    : null;
}

/** Reads the documented `code` field of an API error body without trusting its shape. */
export function getApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null) {
    return null;
  }
  const code = (error.details as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function resolveTutorBookingDecisionError(
  error: unknown,
  copy: TutorBookingInboxCopy,
): TutorBookingDecisionError {
  if (!(error instanceof ApiError)) {
    return { kind: 'UNKNOWN', message: copy.unknownError, requiresRefresh: false };
  }

  if (error.status === 401) {
    return { kind: 'AUTH', message: copy.authError, requiresRefresh: false };
  }
  if (error.status === 403) {
    return { kind: 'OWNERSHIP', message: copy.ownershipError, requiresRefresh: true };
  }
  if (error.status === 404) {
    return { kind: 'MISSING', message: copy.missingError, requiresRefresh: true };
  }
  if (error.status === 409) {
    const raced = getApiErrorCode(error) === 'BOOKING_TRANSITION_CONFLICT';
    return {
      kind: 'STALE',
      message: raced ? copy.staleRaceError : copy.staleStatusError,
      requiresRefresh: true,
    };
  }
  if (error.status === 400) {
    return { kind: 'VALIDATION', message: copy.validationError, requiresRefresh: false };
  }

  return { kind: 'UNKNOWN', message: copy.unknownError, requiresRefresh: false };
}

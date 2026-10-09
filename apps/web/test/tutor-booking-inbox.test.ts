import { describe, expect, it } from 'vitest';

import { tutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import {
  MAX_BOOKING_DECISION_TEXT_LENGTH,
  TUTOR_INBOX_PAGE_SIZE,
  adjustFilteredTotal,
  applyTutorBookingDecision,
  countInboxPages,
  describeDecisionSuccess,
  getApiErrorCode,
  getStudentLabel,
  isDecidableBooking,
  planInboxSyncAfterDecision,
  resolveTutorBookingDecisionError,
  toTutorBookingsQuery,
  validateDecisionText,
} from '@/components/bookings/tutor-booking-inbox-model';
import { ApiError } from '@/lib/api/error';

import type { TutorBookingActionResult, TutorBookingView } from '@/lib/api/types';

const copy = tutorBookingInboxCopy.en;

function booking(overrides: Partial<TutorBookingView> = {}): TutorBookingView {
  return {
    id: 'booking-1',
    status: 'PENDING',
    student: { nickname: 'Mali' },
    listing: {
      id: 'listing-1',
      subjectId: 'subject-math',
      subjectName: 'Mathematics',
      gradeLevelId: 'grade-10',
      gradeLevelName: 'Grade 10',
      pricePerHour: '500.00',
      description: 'Algebra lessons',
    },
    slot: {
      id: 'slot-1',
      startAtUtc: '2099-09-20T03:00:00.000Z',
      endAtUtc: '2099-09-20T04:00:00.000Z',
    },
    subtotalAmount: '500.00',
    discountAmount: '0.00',
    netAmount: '500.00',
    currency: 'THB',
    createdAt: '2099-09-14T00:00:00.000Z',
    ...overrides,
  };
}

function actionResult(overrides: Partial<TutorBookingActionResult> = {}): TutorBookingActionResult {
  return {
    bookingId: 'booking-1',
    status: 'CONFIRMED',
    slotStatus: 'RESERVED',
    canceledAt: null,
    ...overrides,
  };
}

function apiError(status: number, code?: string): ApiError {
  return new ApiError('failed', status, code === undefined ? undefined : { code });
}

describe('tutor booking inbox query model', () => {
  it('sends the status filter only for a single-status view and always paginates', () => {
    expect(toTutorBookingsQuery('PENDING', 1)).toEqual({
      status: 'PENDING',
      page: 1,
      pageSize: TUTOR_INBOX_PAGE_SIZE,
    });
    expect(toTutorBookingsQuery('ALL', 3)).toEqual({
      page: 3,
      pageSize: TUTOR_INBOX_PAGE_SIZE,
    });
  });

  it('keeps at least one page and rounds a partial page up', () => {
    expect(countInboxPages(0)).toBe(1);
    expect(countInboxPages(TUTOR_INBOX_PAGE_SIZE)).toBe(1);
    expect(countInboxPages(TUTOR_INBOX_PAGE_SIZE + 1)).toBe(2);
  });
});

describe('tutor booking decision rules', () => {
  it('offers a decision only on a pending booking', () => {
    expect(isDecidableBooking(booking())).toBe(true);
    for (const status of ['CONFIRMED', 'COMPLETED', 'CANCELED', 'EXPIRED'] as const) {
      expect(isDecidableBooking(booking({ status }))).toBe(false);
    }
  });

  it('applies the server status to the acted-on booking without touching the others', () => {
    const items = [booking(), booking({ id: 'booking-2' })];
    const updated = applyTutorBookingDecision(items, actionResult({ status: 'CANCELED' }));

    expect(updated.map((item) => [item.id, item.status])).toEqual([
      ['booking-1', 'CANCELED'],
      ['booking-2', 'PENDING'],
    ]);
    expect(items[0]?.status).toBe('PENDING');
  });

  it('keeps the filtered total honest once a row leaves the current status view', () => {
    expect(adjustFilteredTotal(5, 'ALL', 'CONFIRMED')).toBe(5);
    expect(adjustFilteredTotal(5, 'CONFIRMED', 'CONFIRMED')).toBe(5);
    expect(adjustFilteredTotal(5, 'PENDING', 'CONFIRMED')).toBe(4);
    expect(adjustFilteredTotal(0, 'PENDING', 'CANCELED')).toBe(0);
  });

  it('refetches the current page when a decision shrinks a single-status view', () => {
    // 21 pending bookings: confirming on page 1 moves item 11 up, so paging on would skip it.
    expect(
      planInboxSyncAfterDecision({ filter: 'PENDING', page: 1, status: 'CONFIRMED', total: 21 }),
    ).toEqual({ total: 20, page: 1, needsReload: true });
  });

  it('clamps the page into the smaller page count the decision leaves behind', () => {
    expect(
      planInboxSyncAfterDecision({ filter: 'PENDING', page: 3, status: 'CANCELED', total: 21 }),
    ).toEqual({ total: 20, page: 2, needsReload: true });
  });

  it('leaves paging alone when the booking stays in the current view', () => {
    expect(
      planInboxSyncAfterDecision({ filter: 'ALL', page: 2, status: 'CONFIRMED', total: 21 }),
    ).toEqual({ total: 21, page: 2, needsReload: false });
    expect(
      planInboxSyncAfterDecision({
        filter: 'CONFIRMED',
        page: 2,
        status: 'CONFIRMED',
        total: 21,
      }),
    ).toEqual({ total: 21, page: 2, needsReload: false });
  });

  it('never reloads on an unknown total, which would claim a page count it cannot know', () => {
    expect(
      planInboxSyncAfterDecision({ filter: 'PENDING', page: 2, status: 'CONFIRMED', total: null }),
    ).toEqual({ total: null, page: 2, needsReload: false });
  });

  it('falls back to a neutral student label when the nickname is missing or blank', () => {
    expect(getStudentLabel(booking(), copy)).toBe('Mali');
    expect(getStudentLabel(booking({ student: { nickname: '  ' } }), copy)).toBe(
      copy.unknownStudent,
    );
    expect(getStudentLabel(booking({ student: { nickname: null } }), copy)).toBe(
      copy.unknownStudent,
    );
  });

  it('reports the slot outcome the server returned for each decision', () => {
    expect(describeDecisionSuccess(actionResult(), copy)).toBe(copy.confirmSuccess);
    expect(
      describeDecisionSuccess(
        actionResult({ status: 'CANCELED', slotStatus: 'AVAILABLE', canceledAt: 'now' }),
        copy,
      ),
    ).toBe(copy.rejectSuccessSlotOpen);
    expect(
      describeDecisionSuccess(
        actionResult({ status: 'CANCELED', slotStatus: 'RESERVED', canceledAt: 'now' }),
        copy,
      ),
    ).toBe(copy.rejectSuccessSlotHeld);
  });

  it('rejects note or reason text longer than the API accepts', () => {
    expect(validateDecisionText('Short note', copy)).toBeNull();
    expect(validateDecisionText(' '.repeat(600), copy)).toBeNull();
    expect(validateDecisionText('a'.repeat(MAX_BOOKING_DECISION_TEXT_LENGTH), copy)).toBeNull();
    expect(validateDecisionText('a'.repeat(MAX_BOOKING_DECISION_TEXT_LENGTH + 1), copy)).toBe(
      copy.textTooLong.replace('{max}', String(MAX_BOOKING_DECISION_TEXT_LENGTH)),
    );
  });
});

describe('tutor booking decision failures', () => {
  it('reads the documented error code without trusting the body shape', () => {
    expect(getApiErrorCode(apiError(409, 'BOOKING_NOT_PENDING'))).toBe('BOOKING_NOT_PENDING');
    expect(getApiErrorCode(apiError(409))).toBeNull();
    expect(getApiErrorCode(new ApiError('failed', 409, 'plain text body'))).toBeNull();
    expect(getApiErrorCode(new Error('offline'))).toBeNull();
  });

  it('asks for a refresh only when the inbox view is known to be stale', () => {
    expect(resolveTutorBookingDecisionError(apiError(401), copy)).toEqual({
      kind: 'AUTH',
      message: copy.authError,
      requiresRefresh: false,
    });
    expect(resolveTutorBookingDecisionError(apiError(403, 'BOOKING_NOT_OWNED'), copy)).toEqual({
      kind: 'OWNERSHIP',
      message: copy.ownershipError,
      requiresRefresh: true,
    });
    expect(resolveTutorBookingDecisionError(apiError(404, 'BOOKING_NOT_FOUND'), copy)).toEqual({
      kind: 'MISSING',
      message: copy.missingError,
      requiresRefresh: true,
    });
    expect(resolveTutorBookingDecisionError(apiError(400), copy)).toEqual({
      kind: 'VALIDATION',
      message: copy.validationError,
      requiresRefresh: false,
    });
    expect(resolveTutorBookingDecisionError(apiError(500), copy)).toEqual({
      kind: 'UNKNOWN',
      message: copy.unknownError,
      requiresRefresh: false,
    });
    expect(resolveTutorBookingDecisionError(new Error('offline'), copy)).toEqual({
      kind: 'UNKNOWN',
      message: copy.unknownError,
      requiresRefresh: false,
    });
  });

  it('gives a missing booking a message of its own so the card can report it', () => {
    const missing = resolveTutorBookingDecisionError(apiError(404, 'BOOKING_NOT_FOUND'), copy);
    const foreign = resolveTutorBookingDecisionError(apiError(403, 'BOOKING_NOT_OWNED'), copy);

    // Both are rendered on the card the tutor acted on, so neither failure may be silent.
    expect(missing.message.trim().length).toBeGreaterThan(0);
    expect(missing.message).not.toBe(foreign.message);
    expect(missing.requiresRefresh).toBe(foreign.requiresRefresh);
  });

  it('separates a booking that left PENDING from a lost concurrent transition', () => {
    expect(resolveTutorBookingDecisionError(apiError(409, 'BOOKING_NOT_PENDING'), copy)).toEqual({
      kind: 'STALE',
      message: copy.staleStatusError,
      requiresRefresh: true,
    });
    expect(
      resolveTutorBookingDecisionError(apiError(409, 'BOOKING_TRANSITION_CONFLICT'), copy),
    ).toEqual({
      kind: 'STALE',
      message: copy.staleRaceError,
      requiresRefresh: true,
    });
  });
});

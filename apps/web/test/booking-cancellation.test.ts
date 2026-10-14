import { describe, expect, it } from 'vitest';

import { bookingCancellationCopy } from '@/components/bookings/booking-cancellation-copy';
import {
  getCancellationEligibility,
  getCancellationFailure,
} from '@/components/bookings/booking-cancellation-model';
import { ApiError } from '@/lib/api/error';

import type { CancellationBooking } from '@/components/bookings/booking-cancellation-model';

const now = Date.parse('2026-10-14T03:00:00Z');
const booking: CancellationBooking = {
  id: 'booking',
  status: 'CONFIRMED',
  slot: { id: 'slot', startAtUtc: '2026-10-15T03:00:00Z', endAtUtc: '2026-10-15T04:00:00Z' },
  listing: {
    id: 'listing',
    subjectId: 'math',
    subjectName: 'Math',
    gradeLevelId: 'grade',
    gradeLevelName: 'Grade 10',
    pricePerHour: '500.00',
    description: '',
  },
};

describe('cancellation eligibility', () => {
  it('allows exactly 24 hours, rejects one millisecond later, independent of timezone offset', () => {
    expect(getCancellationEligibility(booking, now)).toBe('eligible');
    expect(getCancellationEligibility(booking, now + 1)).toBe('tooLate');
    expect(
      getCancellationEligibility(
        { ...booking, slot: { ...booking.slot, startAtUtc: '2026-10-15T10:00:00+07:00' } },
        now,
      ),
    ).toBe('eligible');
  });
  it.each(['PENDING', 'CONFIRMED'] as const)('allows active %s bookings', (status) => {
    expect(getCancellationEligibility({ ...booking, status }, now)).toBe('eligible');
  });
  it.each([
    ['COMPLETED', 'completed'],
    ['CANCELED', 'canceled'],
    ['EXPIRED', 'expired'],
  ] as const)('explains terminal %s bookings', (status, message) => {
    expect(getCancellationEligibility({ ...booking, status }, now)).toBe(message);
  });
  it('fails closed for invalid timestamps and past lessons', () => {
    expect(
      getCancellationEligibility(
        { ...booking, slot: { ...booking.slot, startAtUtc: 'invalid' } },
        now,
      ),
    ).toBe('unavailable');
    expect(getCancellationEligibility(booking, now + 48 * 60 * 60 * 1000)).toBe('tooLate');
  });
});

describe('cancellation failures', () => {
  const copy = bookingCancellationCopy.en;
  it.each([
    ['BOOKING_ALREADY_PAID', copy.paid],
    ['BOOKING_ALREADY_COMPLETED', copy.completed],
    ['BOOKING_ALREADY_CANCELED', copy.canceled],
    ['BOOKING_ALREADY_EXPIRED', copy.expired],
    ['BOOKING_EXCEED_CANCEL_RANGE', copy.tooLate],
  ])('translates %s and requires refreshed server state', (code, message) => {
    expect(getCancellationFailure(new ApiError('server', 409, { code }), copy)).toEqual({
      message,
      requiresRefresh: true,
    });
  });
  it.each([401, 403, 404, 409, 500])('prevents blind retry after HTTP %s', (status) => {
    expect(getCancellationFailure(new ApiError('server', status), copy).requiresRefresh).toBe(true);
  });
  it('retains editable validation errors but locks uncertain transport failures', () => {
    expect(
      getCancellationFailure(new ApiError('server', 400, { code: 'REASON_MISSING' }), copy),
    ).toEqual({ message: copy.required, requiresRefresh: false });
    expect(getCancellationFailure(new TypeError('Failed to fetch'), copy)).toEqual({
      message: copy.uncertain,
      requiresRefresh: true,
    });
  });
  it('keeps Thai and English keys aligned', () => {
    expect(Object.keys(bookingCancellationCopy.th)).toEqual(Object.keys(copy));
  });
});

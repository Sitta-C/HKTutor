import { ApiError } from '@/lib/api/error';

import type { BookingCancellationCopy } from '@/components/bookings/booking-cancellation-copy';
import type { BookingView } from '@/lib/api/types';

export type CancellationBooking = Pick<BookingView, 'id' | 'status' | 'slot' | 'listing'>;
export type CancellationEligibility =
  'eligible' | 'tooLate' | 'completed' | 'canceled' | 'expired' | 'unavailable';

export function getCancellationEligibility(
  booking: CancellationBooking,
  now: number,
): CancellationEligibility {
  if (booking.status === 'COMPLETED') {
    return 'completed';
  }
  if (booking.status === 'CANCELED') {
    return 'canceled';
  }
  if (booking.status === 'EXPIRED') {
    return 'expired';
  }
  const start = Date.parse(booking.slot.startAtUtc);
  if (!Number.isFinite(start) || !Number.isFinite(now)) {
    return 'unavailable';
  }
  return start - now >= 24 * 60 * 60 * 1000 ? 'eligible' : 'tooLate';
}

export function getCancellationFailure(
  error: unknown,
  copy: BookingCancellationCopy,
): { message: string; requiresRefresh: boolean } {
  if (!(error instanceof ApiError)) {
    return { message: copy.uncertain, requiresRefresh: true };
  }
  const details = error.details;
  const code =
    typeof details === 'object' && details !== null && 'code' in details ? details.code : null;
  const messages: Record<string, string> = {
    BOOKING_ALREADY_PAID: copy.paid,
    BOOKING_ALREADY_COMPLETED: copy.completed,
    BOOKING_ALREADY_CANCELED: copy.canceled,
    BOOKING_ALREADY_EXPIRED: copy.expired,
    BOOKING_EXCEED_CANCEL_RANGE: copy.tooLate,
    REASON_MISSING: copy.required,
  };
  const message = typeof code === 'string' ? messages[code] : undefined;
  return {
    message:
      message ??
      (error.status === 400
        ? copy.invalid
        : error.status === 401
          ? copy.session
          : error.status === 403
            ? copy.forbidden
            : error.status === 404
              ? copy.missing
              : error.status === 409
                ? copy.conflict
                : copy.uncertain),
    requiresRefresh: error.status !== 400,
  };
}

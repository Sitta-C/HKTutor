import { ApiError } from '@/lib/api/error';

import type { BookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import type { BookingDetail, PromptPayPayment } from '@/lib/api/types';

export function normalizeBookingCouponCode(code: string): string {
  return code.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

export function isBookingCouponCodeValid(code: string): boolean {
  return /^[A-Z0-9_-]{3,32}$/.test(normalizeBookingCouponCode(code));
}

export function hasActiveBookingPayment(
  booking: Pick<BookingDetail, 'paymentPending'>,
  payment: PromptPayPayment | null,
): boolean {
  return (
    booking.paymentPending === true ||
    payment?.paymentPending === true ||
    payment?.attempt?.status === 'CREATING' ||
    payment?.attempt?.status === 'PENDING'
  );
}

export function isFullCouponSettlement(
  booking: Pick<BookingDetail, 'netAmount' | 'coupon'>,
): boolean {
  return booking.netAmount === '0.00' && booking.coupon?.percent === 100;
}

const COUPON_REJECTION_KEYS = {
  COUPON_NOT_FOUND: 'notFound',
  COUPON_INACTIVE: 'inactive',
  COUPON_EXPIRED: 'expired',
  COUPON_EXHAUSTED: 'exhausted',
  COUPON_ALREADY_USED: 'alreadyUsed',
  PAYMENT_AMOUNT_UNSUPPORTED: 'unsupported',
} as const satisfies Record<string, keyof BookingCouponCopy>;

function couponRejectionKey(error: unknown): keyof BookingCouponCopy | null {
  if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 409)) {
    return null;
  }
  const details = error.details;
  const code =
    typeof details === 'object' && details !== null && 'code' in details ? details.code : null;
  for (const [knownCode, key] of Object.entries(COUPON_REJECTION_KEYS)) {
    if (code === knownCode) {
      return key;
    }
  }
  return null;
}

export function isCouponPaymentRejection(error: unknown): boolean {
  return couponRejectionKey(error) !== null;
}

export function getBookingPaymentFailure(
  error: unknown,
  copy: BookingCouponCopy,
  fallback: string,
  hasCoupon: boolean,
): string {
  const key = couponRejectionKey(error);
  if (key === null) {
    return fallback;
  }
  return hasCoupon ? `${copy[key]} ${copy.paymentRecovery}` : copy[key];
}

export function getBookingCouponFailure(
  error: unknown,
  copy: BookingCouponCopy,
): { message: string; requiresRefresh: boolean } {
  if (!(error instanceof ApiError)) {
    return { message: copy.uncertain, requiresRefresh: true };
  }
  const details = error.details;
  const code =
    typeof details === 'object' && details !== null && 'code' in details ? details.code : null;
  // Only explicit coupon rejections leave the confirmed checkout safe to edit immediately.
  const key = couponRejectionKey(error);
  if (key !== null) {
    return { message: copy[key], requiresRefresh: false };
  }
  return {
    message:
      error.status === 401
        ? copy.session
        : error.status === 403
          ? copy.forbidden
          : error.status === 404
            ? copy.missing
            : code === 'PAYMENT_IN_PROGRESS'
              ? copy.locked
              : code === 'BOOKING_NOT_PAYABLE'
                ? copy.notPayable
                : error.status === 400
                  ? copy.invalid
                  : error.status === 409
                    ? copy.conflict
                    : copy.uncertain,
    requiresRefresh: error.status !== 400,
  };
}

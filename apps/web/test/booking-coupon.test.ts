import { describe, expect, it } from 'vitest';

import { bookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import {
  getBookingCouponFailure,
  hasActiveBookingPayment,
  isBookingCouponCodeValid,
  isFullCouponSettlement,
  normalizeBookingCouponCode,
} from '@/components/bookings/booking-coupon-model';
import { ApiError } from '@/lib/api/error';

import type { PromptPayPayment } from '@/lib/api/types';

describe('student coupon checkout', () => {
  it('normalizes ASCII codes without accepting expanded Unicode equivalents', () => {
    expect(normalizeBookingCouponCode('  welcome10\n')).toBe('WELCOME10');
    expect(isBookingCouponCodeValid('  abc_-123  ')).toBe(true);
    for (const code of ['', 'ab', 'A'.repeat(33), 'SAVE 10', 'ß10', 'ลด10', '<script>']) {
      expect(isBookingCouponCodeValid(code), code).toBe(false);
    }
    expect(isBookingCouponCodeValid('A'.repeat(32))).toBe(true);
  });

  it('requires both a full coupon and an authoritative zero amount for settlement', () => {
    const coupon = { id: 'coupon', code: 'FULL100', percent: 100 };
    expect(isFullCouponSettlement({ coupon, netAmount: '0.00' })).toBe(true);
    expect(isFullCouponSettlement({ coupon, netAmount: '0.01' })).toBe(false);
    expect(isFullCouponSettlement({ coupon: null, netAmount: '0.00' })).toBe(false);
    expect(isFullCouponSettlement({ coupon: { ...coupon, percent: 99 }, netAmount: '0.00' })).toBe(
      false,
    );
  });

  it('locks editing from any server evidence of an active payment, including uncertain creation', () => {
    const payment: PromptPayPayment = {
      bookingId: 'booking',
      paymentStatus: 'UNPAID',
      paymentPending: false,
      paidAt: null,
      reference: null,
      attempt: {
        id: 'attempt',
        status: 'CREATING',
        amount: '405.00',
        currency: 'THB',
        chargeId: null,
        qrCodeUrl: null,
        expiresAt: null,
        failureCode: null,
      },
    };
    expect(hasActiveBookingPayment({}, null)).toBe(false);
    expect(hasActiveBookingPayment({ paymentPending: true }, null)).toBe(true);
    expect(hasActiveBookingPayment({}, payment)).toBe(true);
    if (!payment.attempt) {
      throw new Error('Missing fixture attempt');
    }
    for (const status of ['FAILED', 'EXPIRED', 'SUCCESSFUL'] as const) {
      expect(
        hasActiveBookingPayment({}, { ...payment, attempt: { ...payment.attempt, status } }),
      ).toBe(false);
    }
    expect(hasActiveBookingPayment({}, { ...payment, attempt: null, paymentPending: true })).toBe(
      true,
    );
  });

  for (const language of ['th', 'en'] as const) {
    const text = bookingCouponCopy[language];
    it.each([
      [404, 'COUPON_NOT_FOUND', text.notFound],
      [409, 'COUPON_EXPIRED', text.expired],
      [409, 'COUPON_INACTIVE', text.inactive],
      [409, 'COUPON_EXHAUSTED', text.exhausted],
      [409, 'COUPON_ALREADY_USED', text.alreadyUsed],
      [409, 'PAYMENT_AMOUNT_UNSUPPORTED', text.unsupported],
    ])(`${language}: keeps an explicit %s %s rejection editable`, (status, code, message) => {
      expect(
        getBookingCouponFailure(new ApiError('unsafe server text', status, { code }), text),
      ).toEqual({ message, requiresRefresh: false });
    });

    it.each([
      [401, 'UNAUTHENTICATED', text.session],
      [403, 'BOOKING_NOT_OWNED', text.forbidden],
      [404, 'BOOKING_NOT_FOUND', text.missing],
      [409, 'PAYMENT_IN_PROGRESS', text.locked],
      [409, 'BOOKING_NOT_PAYABLE', text.notPayable],
      [409, 'PAYMENT_STATE_CONFLICT', text.conflict],
      [500, 'INTERNAL_ERROR', text.uncertain],
    ])(`${language}: requires reconciliation for %s %s`, (status, code, message) => {
      expect(
        getBookingCouponFailure(new ApiError('unsafe server text', status, { code }), text),
      ).toEqual({ message, requiresRefresh: true });
    });

    it(`${language}: treats a lost response as uncertain and never displays arbitrary server text`, () => {
      expect(getBookingCouponFailure(new TypeError('Network error'), text)).toEqual({
        message: text.uncertain,
        requiresRefresh: true,
      });
      expect(getBookingCouponFailure(new ApiError('<script>private</script>', 400), text)).toEqual({
        message: text.invalid,
        requiresRefresh: false,
      });
    });
  }
});

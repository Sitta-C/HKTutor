import { ConflictException } from '@nestjs/common';

import { bookingPaymentDeadline } from '@modules/bookings/booking-payment-policy';

/** The deadline itself is closed; this also applies to zero-net coupon settlement. */
export function assertBeforePaymentDeadline(startAtUtc: Date, now = Date.now()): void {
  if (now >= bookingPaymentDeadline(startAtUtc).getTime()) {
    throw new ConflictException({
      code: 'BOOKING_PAYMENT_DEADLINE_PASSED',
      message: 'Payment must be completed before the lesson starts',
    });
  }
}

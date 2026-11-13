import { assertBeforePaymentDeadline } from '@modules/bookings/booking-payment-deadline';
import { bookingPaymentDeadline } from '@modules/bookings/booking-payment-policy';

describe('booking payment deadline', () => {
  const start = new Date('2026-11-15T11:00:00Z'); // 18:00 Bangkok
  const deadline = new Date('2026-11-15T07:00:00Z'); // 14:00 Bangkok

  it('closes four elapsed hours before start, including Bangkok day rollover', () => {
    expect(bookingPaymentDeadline(start)).toEqual(deadline);
    expect(bookingPaymentDeadline(new Date('2026-11-15T01:00:00+07:00'))).toEqual(
      new Date('2026-11-14T14:00:00Z'),
    );
  });

  it('allows the last millisecond before the deadline', () => {
    expect(() => assertBeforePaymentDeadline(start, deadline.getTime() - 1)).not.toThrow();
  });

  it.each([0, 1, 4 * 3_600_000, 24 * 3_600_000])('closes at deadline + %d ms', (delta) => {
    expect(() => assertBeforePaymentDeadline(start, deadline.getTime() + delta)).toThrow(
      'Payment must be completed before the deadline, 4 hours before the lesson starts',
    );
  });
});

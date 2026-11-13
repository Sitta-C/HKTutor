import { describe, expect, it } from 'vitest';

import { bookingPaymentDeadline, hasPaymentDeadlinePassed } from '@/lib/booking-payment-deadline';

describe('booking payment deadline', () => {
  const start = '2026-11-15T18:00:00+07:00';
  const deadline = Date.parse(start);

  it('uses the same instant for Bangkok and UTC timestamps', () => {
    expect(bookingPaymentDeadline(start)).toBe(deadline);
    expect(bookingPaymentDeadline('2026-11-15T11:00:00Z')).toBe(deadline);
  });

  it.each([
    [-1, false],
    [0, true],
    [1, true],
    [4 * 3_600_000, true],
  ])('closes at deadline + %d ms: %s', (margin, closed) => {
    expect(hasPaymentDeadlinePassed(start, deadline + Number(margin))).toBe(closed);
  });
});

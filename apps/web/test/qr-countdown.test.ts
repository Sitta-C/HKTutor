import { describe, expect, it } from 'vitest';

import { getQrCountdown } from '@/components/bookings/qr-countdown';

describe('QR deadline countdown', () => {
  const now = Date.parse('2026-11-13T08:00:00Z');
  const expiry = new Date(now + 15 * 60_000).toISOString();

  it('uses the stored deadline, rounds remaining fractions upward and clamps expired time', () => {
    expect(getQrCountdown(expiry, now)).toBe('15:00');
    expect(getQrCountdown(expiry, now + 1000)).toBe('14:59');
    expect(getQrCountdown(expiry, now + 899_001)).toBe('00:01');
    expect(getQrCountdown(expiry, now + 900_000)).toBe('00:00');
    expect(getQrCountdown(expiry, now + 999_000)).toBe('00:00');
  });

  it('recomputes after a suspended tab without resetting or accumulating tick drift', () => {
    expect(getQrCountdown(expiry, now + 7 * 60_000 + 30_000)).toBe('07:30');
    expect(getQrCountdown(expiry, now + 14 * 60_000)).toBe('01:00');
  });

  it('does not invent a deadline from missing or invalid timing data', () => {
    expect(getQrCountdown('', now)).toBeNull();
    expect(getQrCountdown('invalid', now)).toBeNull();
    expect(getQrCountdown(expiry, Number.NaN)).toBeNull();
  });
});

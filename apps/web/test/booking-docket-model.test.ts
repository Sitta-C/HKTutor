import { describe, expect, it } from 'vitest';

import { formatBookingDocketSlot } from '@/components/bookings/booking-docket-model';

function range(startAtUtc: string, endAtUtc: string, language: 'th' | 'en' = 'en') {
  return formatBookingDocketSlot({ id: 'preview-slot', startAtUtc, endAtUtc }, language);
}

describe('booking docket time presentation', () => {
  it('uses Bangkok time and Thai Buddhist years', () => {
    const result = range('2026-10-12T03:00:00Z', '2026-10-12T04:30:00Z', 'th');
    expect(result.start).toBe('10:00');
    expect(result.end).toBe('11:30');
    expect(result.startDate).toContain('2569');
    expect(result.endDate).toBeNull();
  });

  it('labels both dates when a lesson crosses Bangkok midnight', () => {
    const result = range('2026-12-31T16:30:00Z', '2026-12-31T18:00:00Z');
    expect(result.start).toBe('23:30');
    expect(result.end).toBe('01:00');
    expect(result.startDate).toBe('31 Dec 2026');
    expect(result.endDate).toBe('1 Jan 2027');
    expect(result.label).toContain('1 Jan 2027 · 01:00');
  });

  it('shows exact midnight as 24:00 without adding an empty next day', () => {
    const result = range('2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z');
    expect(result.end).toBe('24:00');
    expect(result.endDate).toBeNull();
    expect(result.label).toBe('12 Oct 2026 · 23:00 → 13 Oct 2026 · 00:00');
  });

  it('keeps the last occupied date on multi-day midnight endings', () => {
    const result = range('2026-10-12T16:00:00Z', '2026-10-14T17:00:00Z');
    expect(result.end).toBe('24:00');
    expect(result.endDate).toBe('14 Oct 2026');
    expect(result.label).toContain('15 Oct 2026 · 00:00');
  });
});

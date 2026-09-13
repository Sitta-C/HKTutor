import { describe, expect, it } from 'vitest';

import {
  addIsoDays,
  formatBangkokDate,
  formatBangkokDateTime,
  formatBangkokWeekRange,
  formatBangkokYear,
  formatCalendarDate,
  formatCalendarMonth,
  formatUtcDateTime,
  getBangkokToday,
  getCalendarMonthDays,
  shiftIsoMonth,
} from '@/lib/date-time';

describe('localized calendars', () => {
  it('shows Gregorian years in English and Buddhist years in Thai', () => {
    const instant = new Date('2026-09-12T18:00:00.000Z');

    expect(formatBangkokDate(instant, 'en')).toContain('2026');
    expect(formatBangkokDate(instant, 'th')).toContain('2569');
    expect(formatBangkokDateTime(instant, 'th')).toContain('2569');
    expect(formatUtcDateTime(instant, 'th')).toContain('2569');
    expect(formatBangkokYear(instant, 'en')).toContain('2026');
    expect(formatBangkokYear(instant, 'th')).toContain('2569');
  });

  it('formats ISO calendar values without changing their Gregorian storage value', () => {
    expect(formatCalendarDate('2026-09-13', 'en')).toContain('2026');
    expect(formatCalendarDate('2026-09-13', 'th')).toContain('2569');
    expect(formatCalendarMonth('2026-09-13', 'th')).toContain('2569');
    expect(addIsoDays('2026-09-13', 1)).toBe('2026-09-14');
  });

  it('keeps the Bangkok boundary and localized week range consistent', () => {
    const saturdayUtcEvening = new Date('2026-09-12T18:00:00.000Z');

    expect(getBangkokToday(saturdayUtcEvening)).toBe('2026-09-13');
    expect(formatBangkokWeekRange('2026-09-07', 'en')).toMatch(/2026/);
    expect(formatBangkokWeekRange('2026-09-07', 'th')).toMatch(/2569/);
  });

  it('builds a Monday-first six-week grid and clamps month shifts', () => {
    const days = getCalendarMonthDays('2026-09-13');

    expect(days).toHaveLength(42);
    expect(days[0]).toMatchObject({ isoDate: '2026-08-31', inCurrentMonth: false });
    expect(days[41]).toMatchObject({ isoDate: '2026-10-11', inCurrentMonth: false });
    expect(shiftIsoMonth('2026-01-31', 1)).toBe('2026-02-28');
  });
});

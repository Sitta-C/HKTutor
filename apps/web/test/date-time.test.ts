import { describe, expect, it } from 'vitest';

import {
  addIsoDays,
  formatBangkokDate,
  formatBangkokDateParts,
  formatBangkokDateRange,
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
  it('splits calendar tiles using the Bangkok day and localized calendar year', () => {
    const instant = '2026-12-31T18:00:00Z';
    expect(formatBangkokDateParts(instant, 'en')).toEqual({ day: '1', month: 'Jan', year: '2027' });
    expect(formatBangkokDateParts(instant, 'th')).toEqual({
      day: '1',
      month: 'ม.ค.',
      year: '2570',
    });
  });
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

  it('compacts cross-day ranges without repeating the month or year', () => {
    const start = '2026-10-06T11:00:00.000Z';
    const end = '2026-10-07T12:00:00.000Z';
    expect(formatBangkokDateRange(start, end, 'th')).toBe('6–7 ต.ค. 2569');
    expect(formatBangkokDateRange(start, end, 'en')).toMatch(/6\s*–\s*7 Oct 2026/);
  });

  it('keeps both months and calendar years when a range crosses Bangkok midnight', () => {
    expect(
      formatBangkokDateRange('2026-10-31T16:00:00.000Z', '2026-10-31T18:00:00.000Z', 'th'),
    ).toBe('31 ต.ค. – 1 พ.ย. 2569');
    expect(
      formatBangkokDateRange('2026-12-31T16:00:00.000Z', '2026-12-31T18:00:00.000Z', 'th'),
    ).toBe('31 ธ.ค. 2569 – 1 ม.ค. 2570');
    expect(
      formatBangkokDateRange('2026-12-31T16:00:00.000Z', '2026-12-31T18:00:00.000Z', 'en'),
    ).toMatch(/31 Dec 2026\s*–\s*1 Jan 2027/);
  });
});

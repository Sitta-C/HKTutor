import { describe, expect, it } from 'vitest';

import {
  bangkokDateTimeToUtc,
  getBangkokWeekRange,
  getBangkokWeekStart,
  getDurationHoursMinutes,
} from '@/lib/api/availability';
import { getBangkokToday } from '@/lib/date-time';
import { translations } from '@/lib/i18n';

describe('Bangkok availability dates', () => {
  it('keeps today and week start separate around the Bangkok date boundary', () => {
    const saturdayUtcEvening = new Date('2026-09-12T18:00:00.000Z');

    expect(getBangkokToday(saturdayUtcEvening)).toBe('2026-09-13');
    expect(getBangkokWeekStart(saturdayUtcEvening)).toBe('2026-09-07');
  });

  it('converts a Bangkok input to UTC and builds an exclusive weekly API range', () => {
    expect(bangkokDateTimeToUtc('2026-09-13', '01:00').toISOString()).toBe(
      '2026-09-12T18:00:00.000Z',
    );
    expect(getBangkokWeekRange('2026-09-07')).toEqual({
      from: '2026-09-06T17:00:00.000Z',
      to: '2026-09-13T17:00:00.000Z',
    });
  });

  it('rounds decimal teaching hours into whole hours and minutes', () => {
    expect(getDurationHoursMinutes(4.17)).toEqual({ hours: 4, minutes: 10 });
    expect(getDurationHoursMinutes(1)).toEqual({ hours: 1, minutes: 0 });
  });
});

describe('availability translations', () => {
  it('keeps English and Thai availability keys aligned', () => {
    expect(Object.keys(translations.en.dashboard.availability).sort()).toEqual(
      Object.keys(translations.th.dashboard.availability).sort(),
    );
  });
});

import { describe, expect, it } from 'vitest';

import { buildRulerItems, shiftRulerValue } from '@/components/date-time/calendar-ruler-model';

describe('calendar ruler ranges', () => {
  it('moves weeks in seven-day steps across months, leap days, and years', () => {
    expect(shiftRulerValue('2026-10-05', 'week', -1)).toBe('2026-09-28');
    expect(shiftRulerValue('2026-12-28', 'week', 1)).toBe('2027-01-04');
    expect(shiftRulerValue('2024-02-26', 'week', 1)).toBe('2024-03-04');
  });

  it('preserves the month ruler calendar and year boundaries', () => {
    expect(shiftRulerValue('2026-12', 'month', 1)).toBe('2027-01');
    expect(shiftRulerValue('2026-10', 'month', -12)).toBe('2025-10');
    const month = buildRulerItems('2026-10', 'month', 'th')[12];
    expect(month).toMatchObject({
      value: '2026-10',
      title: 'ต.ค.',
      label: 'ตุลาคม 2569',
    });
    expect(month?.subtitle).toContain('2569');
  });

  it('keeps a bounded set of consecutive Monday-starting weeks', () => {
    const items = buildRulerItems('2026-10-05', 'week', 'en');
    expect(items).toHaveLength(25);
    expect(items[12]?.value).toBe('2026-10-05');
    for (const [index, item] of items.entries()) {
      expect(new Date(`${item.value}T00:00:00Z`).getUTCDay()).toBe(1);
      if (index > 0) {
        expect(
          new Date(item.value).getTime() - new Date(items[index - 1]?.value ?? '').getTime(),
        ).toBe(7 * 24 * 60 * 60 * 1000);
      }
    }
  });

  it.each(['en', 'th'] as const)('makes cross-month weeks unambiguous in %s', (language) => {
    const item = buildRulerItems('2026-09-28', 'week', language)[12];
    expect(item?.title).toBe('28–4');
    expect(item?.subtitle).toContain(language === 'th' ? 'ก.ย.' : 'Sept');
    expect(item?.subtitle).toContain(language === 'th' ? 'ต.ค.' : 'Oct');
    expect(item?.label).toContain(language === 'th' ? '2569' : '2026');
  });

  it.each(['en', 'th'] as const)('includes both years for a cross-year week in %s', (language) => {
    const item = buildRulerItems('2026-12-28', 'week', language)[12];
    expect(item?.title).toBe('28–3');
    expect(item?.subtitle).toContain(language === 'th' ? '2569' : '2026');
    expect(item?.subtitle).toContain(language === 'th' ? '2570' : '2027');
    expect(item?.label).toContain(language === 'th' ? '2569' : '2026');
    expect(item?.label).toContain(language === 'th' ? '2570' : '2027');
  });
});

import { describe, expect, it } from 'vitest';

import {
  formatPublicTutorSlot,
  groupPublicTutorSlots,
} from '@/components/tutors/public-tutor-detail-model';

import type { PublicAvailabilitySlot } from '@/lib/api/types';

const overnight: PublicAvailabilitySlot = {
  id: 'overnight',
  startAtUtc: '2026-12-31T16:00:00.000Z',
  endAtUtc: '2026-12-31T18:00:00.000Z',
};

describe('public tutor appointment days', () => {
  it('groups by Bangkok start date while preserving API order and whole slots', () => {
    const nextDay = { ...overnight, id: 'next', startAtUtc: '2026-12-31T17:30:00Z' };
    const sameDay = { ...overnight, id: 'earlier', startAtUtc: '2026-12-31T14:00:00Z' };
    const input = [overnight, nextDay, sameDay];
    const days = groupPublicTutorSlots(input, 'en');
    expect(days.map((day) => day.key)).toEqual(['2026-12-31', '2027-01-01']);
    expect(days[0]?.slots).toEqual([overnight, sameDay]);
    expect(days[1]?.slots).toEqual([nextDay]);
    expect(input).toEqual([overnight, nextDay, sameDay]);
    expect(days.flatMap((day) => day.slots)).toHaveLength(3);
  });

  it('uses Gregorian keys but localized Buddhist and Gregorian display years', () => {
    expect(groupPublicTutorSlots([overnight], 'th')[0]).toMatchObject({
      key: '2026-12-31',
      year: '2569',
      day: '31',
    });
    expect(groupPublicTutorSlots([overnight], 'en')[0]).toMatchObject({
      key: '2026-12-31',
      year: '2026',
      day: '31',
    });
  });

  it('shows both endpoint dates when a range crosses a Bangkok date/year boundary', () => {
    expect(formatPublicTutorSlot(overnight, 'en')).toMatchObject({
      start: '23:00',
      end: '01:00',
      endDate: '1 Jan 2027',
    });
    const thai = formatPublicTutorSlot(overnight, 'th');
    expect(thai.label).toContain('2569');
    expect(thai.endDate).toContain('2570');
  });

  it('makes a midnight endpoint explicit without splitting the underlying slot', () => {
    const slot = { ...overnight, endAtUtc: '2026-12-31T17:00:00Z' };
    expect(formatPublicTutorSlot(slot, 'en')).toMatchObject({
      start: '23:00',
      end: '00:00',
      endDate: '1 Jan 2027',
    });
    expect(groupPublicTutorSlots([slot], 'en')).toHaveLength(1);
  });

  it('keeps a same-day time concise and treats successful empty data as empty', () => {
    expect(
      formatPublicTutorSlot({ ...overnight, endAtUtc: '2026-12-31T16:30:00Z' }, 'en'),
    ).toMatchObject({ start: '23:00', end: '23:30', endDate: null });
    expect(groupPublicTutorSlots([], 'en')).toEqual([]);
  });
});

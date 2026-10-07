import {
  formatBangkokDate,
  formatBangkokDateParts,
  formatBangkokShortDate,
  formatBangkokTime,
  formatBangkokWeekday,
  getBangkokIsoDate,
} from '@/lib/date-time';

import type { PublicAvailabilitySlot } from '@/lib/api/types';
import type { DateTimeLanguage } from '@/lib/date-time';

export interface PublicTutorDay {
  key: string;
  day: string;
  month: string;
  year: string;
  weekday: string;
  label: string;
  indexLabel: string;
  slots: PublicAvailabilitySlot[];
}

export function groupPublicTutorSlots(
  slots: PublicAvailabilitySlot[],
  language: DateTimeLanguage,
): PublicTutorDay[] {
  const groups = new Map<string, PublicTutorDay>();
  for (const slot of slots) {
    const key = getBangkokIsoDate(slot.startAtUtc);
    const existing = groups.get(key);
    if (existing) {
      existing.slots.push(slot);
    } else {
      const parts = formatBangkokDateParts(slot.startAtUtc, language);
      groups.set(key, {
        key,
        ...parts,
        weekday: formatBangkokWeekday(slot.startAtUtc, language, 'short'),
        label: formatBangkokDate(slot.startAtUtc, language),
        indexLabel: `${parts.day} ${parts.month}`,
        slots: [slot],
      });
    }
  }
  return Array.from(groups.values());
}

export function formatPublicTutorSlot(
  slot: PublicAvailabilitySlot,
  language: DateTimeLanguage,
): { start: string; end: string; startDate: string; endDate: string | null; label: string } {
  const start = formatBangkokTime(slot.startAtUtc, language);
  const endAt = new Date(slot.endAtUtc);
  const lastOccupiedInstant = new Date(endAt.getTime() - 1);
  const endsAtMidnight = getBangkokIsoDate(lastOccupiedInstant) !== getBangkokIsoDate(endAt);
  // Tutor availability labels midnight as 24:00 on the last occupied Bangkok date.
  const endLabelDate = endsAtMidnight ? lastOccupiedInstant : endAt;
  const end = endsAtMidnight ? '24:00' : formatBangkokTime(endAt, language);
  const endDate =
    getBangkokIsoDate(slot.startAtUtc) !== getBangkokIsoDate(endLabelDate)
      ? formatBangkokShortDate(endLabelDate, language)
      : null;
  const crossesDay = getBangkokIsoDate(slot.startAtUtc) !== getBangkokIsoDate(slot.endAtUtc);
  const startDate = formatBangkokShortDate(slot.startAtUtc, language);
  return {
    start,
    end,
    startDate,
    endDate,
    // The accessible range retains the actual UTC endpoints, including next-day 00:00.
    label: crossesDay
      ? `${startDate} · ${start} → ${formatBangkokShortDate(endAt, language)} · ${formatBangkokTime(endAt, language)}`
      : `${startDate} · ${start}–${end}`,
  };
}

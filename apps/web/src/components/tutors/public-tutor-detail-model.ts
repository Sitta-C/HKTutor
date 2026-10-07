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
        indexLabel: formatBangkokShortDate(slot.startAtUtc, language),
        slots: [slot],
      });
    }
  }
  return Array.from(groups.values());
}

export function formatPublicTutorSlot(
  slot: PublicAvailabilitySlot,
  language: DateTimeLanguage,
): { start: string; end: string; endDate: string | null; label: string } {
  const start = formatBangkokTime(slot.startAtUtc, language);
  const end = formatBangkokTime(slot.endAtUtc, language);
  const crossesDay = getBangkokIsoDate(slot.startAtUtc) !== getBangkokIsoDate(slot.endAtUtc);
  const endDate = crossesDay ? formatBangkokShortDate(slot.endAtUtc, language) : null;
  const startDate = formatBangkokShortDate(slot.startAtUtc, language);
  return {
    start,
    end,
    endDate,
    label: crossesDay
      ? `${startDate} · ${start} → ${endDate} · ${end}`
      : `${startDate} · ${start}–${end}`,
  };
}

import { formatBangkokShortDate, formatBangkokTime, getBangkokIsoDate } from '@/lib/date-time';

import type { BookingQuoteSlot } from '@/lib/api/types';
import type { DateTimeLanguage } from '@/lib/date-time';

export function formatBookingDocketSlot(
  slot: BookingQuoteSlot,
  language: DateTimeLanguage,
): { start: string; end: string; startDate: string; endDate: string | null; label: string } {
  const start = formatBangkokTime(slot.startAtUtc, language);
  const endAt = new Date(slot.endAtUtc);
  const lastOccupiedInstant = new Date(endAt.getTime() - 1);
  const endsAtMidnight = getBangkokIsoDate(lastOccupiedInstant) !== getBangkokIsoDate(endAt);
  // Match Appointment Pad: display midnight on the last occupied date, retaining actual endpoints.
  const endLabelDate = endsAtMidnight ? lastOccupiedInstant : endAt;
  const end = endsAtMidnight ? '24:00' : formatBangkokTime(endAt, language);
  const startDate = formatBangkokShortDate(slot.startAtUtc, language);
  const endDate =
    getBangkokIsoDate(slot.startAtUtc) !== getBangkokIsoDate(endLabelDate)
      ? formatBangkokShortDate(endLabelDate, language)
      : null;
  const crossesDay = getBangkokIsoDate(slot.startAtUtc) !== getBangkokIsoDate(endAt);

  return {
    start,
    end,
    startDate,
    endDate,
    label: crossesDay
      ? `${startDate} · ${start} → ${formatBangkokShortDate(endAt, language)} · ${formatBangkokTime(endAt, language)}`
      : `${startDate} · ${start}–${end}`,
  };
}

import { bangkokDateTimeToUtc, getBangkokWeekRange } from '@/lib/api/availability';
import { addIsoDays, getBangkokIsoDate } from '@/lib/date-time';

import type { TutorAvailabilitySlot } from '@/lib/api/types';

export interface AvailabilityDaySegment {
  readonly slot: TutorAvailabilitySlot;
  readonly startAtUtc: string;
  readonly endAtUtc: string;
  readonly isContinuation: boolean;
  readonly endsAtMidnight: boolean;
}

export interface AvailabilityWeek {
  readonly slots: TutorAvailabilitySlot[];
  readonly days: Array<[string, AvailabilityDaySegment[]]>;
}

export interface AvailabilitySlotSpan {
  readonly slot: TutorAvailabilitySlot;
  readonly firstSegment: AvailabilityDaySegment;
  readonly lastSegment: AvailabilityDaySegment;
  readonly firstDay: string;
  readonly lastDay: string;
  readonly rowStart: number;
  readonly rowEnd: number;
}

export function buildAvailabilityWeekLayout(week: AvailabilityWeek): {
  days: Array<{
    day: string;
    startAtUtc: string;
    rowStart: number;
    rowEnd: number;
    separatorRow: number | null;
  }>;
  spans: AvailabilitySlotSpan[];
  gridTemplateRows: string;
} {
  const tracks: string[] = [];
  const days = [];
  const spans = new Map<string, AvailabilitySlotSpan>();

  for (const [day, segments] of week.days) {
    let separatorRow = null;
    if (tracks.length > 0) {
      separatorRow = tracks.length + 1;
      tracks.push('40px');
    }
    const rowStart = tracks.length + 1;
    for (const [index, segment] of segments.entries()) {
      if (index > 0) {
        tracks.push('8px');
      }
      const segmentRow = tracks.length + 1;
      tracks.push('minmax(var(--availability-row-height), auto)');
      const existing = spans.get(segment.slot.id);
      // Daily portions only establish grid positions; each slot renders as one continuous card.
      spans.set(segment.slot.id, {
        slot: segment.slot,
        firstSegment: existing?.firstSegment ?? segment,
        lastSegment: segment,
        firstDay: existing?.firstDay ?? day,
        lastDay: day,
        rowStart: existing?.rowStart ?? segmentRow,
        rowEnd: segmentRow + 1,
      });
    }
    days.push({
      day,
      startAtUtc: segments.at(0)?.startAtUtc ?? day,
      rowStart,
      rowEnd: tracks.length + 1,
      separatorRow,
    });
  }
  return { days, spans: [...spans.values()], gridTemplateRows: tracks.join(' ') };
}

export function buildAvailabilityWeek(
  slots: TutorAvailabilitySlot[],
  weekStart: string,
): AvailabilityWeek {
  const range = getBangkokWeekRange(weekStart);
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const visibleSlots = slots.filter((slot) => {
    const start = new Date(slot.startAtUtc).getTime();
    const end = new Date(slot.endAtUtc).getTime();
    return start < end && start < to && end > from;
  });
  const groups = new Map<string, AvailabilityDaySegment[]>();

  for (const slot of visibleSlots) {
    const start = new Date(slot.startAtUtc).getTime();
    const end = Math.min(new Date(slot.endAtUtc).getTime(), to);
    let cursor = Math.max(start, from);
    while (cursor < end) {
      const day = getBangkokIsoDate(new Date(cursor));
      const midnight = bangkokDateTimeToUtc(addIsoDays(day, 1), '00:00').getTime();
      const segmentEnd = Math.min(end, midnight);
      const segment: AvailabilityDaySegment = {
        slot,
        startAtUtc: new Date(cursor).toISOString(),
        endAtUtc: new Date(segmentEnd).toISOString(),
        isContinuation: cursor > start,
        endsAtMidnight: segmentEnd === midnight,
      };
      const daySegments = groups.get(day) ?? [];
      daySegments.push(segment);
      groups.set(day, daySegments);
      cursor = segmentEnd;
    }
  }

  const days = [...groups.entries()].sort(([first], [second]) => first.localeCompare(second));
  for (const [, segments] of days) {
    segments.sort((first, second) => first.startAtUtc.localeCompare(second.startAtUtc));
  }
  return { slots: visibleSlots, days };
}

export function safeBangkokDateTime(date: string, time: string): Date | null {
  try {
    return bangkokDateTimeToUtc(date, time);
  } catch {
    return null;
  }
}

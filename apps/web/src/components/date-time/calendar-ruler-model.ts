import { addIsoDays, getCalendarLocale, parseIsoDate, shiftIsoMonth } from '@/lib/date-time';

import type { DateTimeLanguage } from '@/lib/date-time';

export type CalendarRulerUnit = 'month' | 'week';

export interface CalendarRulerItem {
  value: string;
  title: string;
  subtitle: string;
  label: string;
}

export const RULER_ITEMS_EACH_SIDE = 12;

export function shiftRulerValue(value: string, unit: CalendarRulerUnit, amount: number): string {
  return unit === 'month'
    ? shiftIsoMonth(`${value}-01`, amount).slice(0, 7)
    : addIsoDays(value, amount * 7);
}

export function buildRulerItems(
  anchor: string,
  unit: CalendarRulerUnit,
  language: DateTimeLanguage,
): CalendarRulerItem[] {
  const locale = getCalendarLocale(language);
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const fullMonth = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const year = new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' });
  const monthYear = new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' });
  const fullDate = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return Array.from({ length: RULER_ITEMS_EACH_SIDE * 2 + 1 }, (_, index) => {
    const value = shiftRulerValue(anchor, unit, index - RULER_ITEMS_EACH_SIDE);
    const start = parseIsoDate(unit === 'month' ? `${value}-01` : value);
    if (unit === 'month') {
      return {
        value,
        title: month.format(start),
        subtitle: year.format(start),
        label: fullMonth.format(start),
      };
    }
    const end = parseIsoDate(addIsoDays(value, 6));
    return {
      value,
      title: `${day.format(start)}–${day.format(end)}`,
      subtitle: monthYear.formatRange(start, end),
      label: fullDate.formatRange(start, end),
    };
  });
}

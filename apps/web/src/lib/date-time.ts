export type DateTimeLanguage = 'en' | 'th';

export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

const CALENDAR_LOCALES: Record<DateTimeLanguage, string> = {
  en: 'en-GB-u-ca-gregory',
  th: 'th-TH-u-ca-buddhist',
};

export function getCalendarLocale(language: DateTimeLanguage): string {
  return CALENDAR_LOCALES[language];
}

export function formatBangkokDate(value: string | Date, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    day: 'numeric',
    month: 'short',
    timeZone: BANGKOK_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatBangkokShortDate(value: string | Date, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    day: 'numeric',
    month: 'short',
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
  }).format(new Date(value));
}

export function formatBangkokWeekday(value: string | Date, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    timeZone: BANGKOK_TIME_ZONE,
    weekday: 'long',
  }).format(new Date(value));
}

export function formatBangkokDateTime(value: string | Date, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: 'short',
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
  }).format(new Date(value));
}

export function formatBangkokTime(value: string | Date, language: DateTimeLanguage = 'en'): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: BANGKOK_TIME_ZONE,
  }).format(new Date(value));
}

export function formatUtcDateTime(value: string | Date, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    day: 'numeric',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatBangkokYear(value: string | Date, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
  }).format(new Date(value));
}

export function formatCalendarDate(isoDate: string, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
  }).format(parseIsoDate(isoDate));
}

export function formatCalendarMonth(isoDate: string, language: DateTimeLanguage): string {
  return new Intl.DateTimeFormat(getCalendarLocale(language), {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(parseIsoDate(isoDate));
}

export function formatBangkokWeekRange(weekStart: string, language: DateTimeLanguage): string {
  const start = parseIsoDate(weekStart);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat(getCalendarLocale(language), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

export function getBangkokToday(date = new Date()): string {
  return getBangkokIsoDate(date);
}

export function getBangkokIsoDate(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory', {
    day: '2-digit',
    month: '2-digit',
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function parseIsoDate(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error('Invalid ISO date');
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new Error('Invalid ISO date');
  }
  return result;
}

export function formatIsoDate(date: Date): string {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) =>
      index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'),
    )
    .join('-');
}

export function addIsoDays(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

export function startOfIsoMonth(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(1);
  return formatIsoDate(date);
}

export function shiftIsoMonth(isoDate: string, months: number): string {
  const date = parseIsoDate(isoDate);
  const wantedDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(wantedDay, lastDay));
  return formatIsoDate(date);
}

export function getMondayBasedWeekday(isoDate: string): number {
  return (parseIsoDate(isoDate).getUTCDay() + 6) % 7;
}

export function getCalendarWeekdayLabels(language: DateTimeLanguage): string[] {
  const formatter = new Intl.DateTimeFormat(getCalendarLocale(language), {
    timeZone: 'UTC',
    weekday: 'short',
  });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(Date.UTC(2024, 0, 1 + index))),
  );
}

export interface CalendarDay {
  isoDate: string;
  day: number;
  inCurrentMonth: boolean;
}

export function getCalendarMonthDays(month: string): CalendarDay[] {
  const monthStart = startOfIsoMonth(month);
  const gridStart = addIsoDays(monthStart, -getMondayBasedWeekday(monthStart));
  const currentMonth = monthStart.slice(0, 7);

  return Array.from({ length: 42 }, (_, index) => {
    const isoDate = addIsoDays(gridStart, index);
    return {
      isoDate,
      day: parseIsoDate(isoDate).getUTCDate(),
      inCurrentMonth: isoDate.startsWith(currentMonth),
    };
  });
}

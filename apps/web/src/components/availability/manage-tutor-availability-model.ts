import { bangkokDateTimeToUtc, getDurationHoursMinutes } from '@/lib/api/availability';

export function formatAvailabilityDuration(hours: number): string {
  return Number.isInteger(hours)
    ? String(hours)
    : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatAvailabilityHoursMinutes(
  totalHours: number,
  singularHour: string,
  pluralHour: string,
  singularMinute: string,
  pluralMinute: string,
): string {
  const { hours, minutes } = getDurationHoursMinutes(totalHours);
  const hourLabel = (hours === 1 ? singularHour : pluralHour).replace('{count}', String(hours));
  const minuteLabel = (minutes === 1 ? singularMinute : pluralMinute).replace(
    '{count}',
    String(minutes),
  );
  return `${hourLabel} ${minuteLabel}`;
}

export function formatAvailabilityDurationLabel(
  hours: number,
  singular: string,
  plural: string,
): string {
  return (hours === 1 ? singular : plural).replace('{hours}', formatAvailabilityDuration(hours));
}

export function safeBangkokDateTime(date: string, time: string): Date | null {
  try {
    return bangkokDateTimeToUtc(date, time);
  } catch {
    return null;
  }
}

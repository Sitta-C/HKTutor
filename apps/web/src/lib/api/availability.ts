'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  AvailabilityQuery,
  CreateAvailabilityPayload,
  CreatedAvailabilitySlot,
  TutorAvailabilitySlot,
} from '@/lib/api/types';

export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
export const BANGKOK_UTC_OFFSET_HOURS = 7;

export function getTutorAvailability(
  query: AvailabilityQuery = {},
): Promise<TutorAvailabilitySlot[]> {
  const params = new URLSearchParams();
  if (query.from !== undefined) params.set('from', toIsoString(query.from));
  if (query.to !== undefined) params.set('to', toIsoString(query.to));

  const queryString = params.toString();
  return authenticatedFetch<TutorAvailabilitySlot[]>(
    `/tutors/me/availability${queryString ? `?${queryString}` : ''}`,
  );
}

export function createTutorAvailability(
  payload: CreateAvailabilityPayload,
): Promise<CreatedAvailabilitySlot> {
  return authenticatedFetch<CreatedAvailabilitySlot>('/tutors/me/availability', {
    body: JSON.stringify(payload),
    method: 'POST',
  });
}

export function deleteTutorAvailability(slotId: string): Promise<void> {
  return authenticatedFetch<void>(`/tutors/me/availability/${encodeURIComponent(slotId)}`, {
    method: 'DELETE',
  });
}

export function bangkokDateTimeToUtc(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Invalid Bangkok date or time');
  }

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  const utcMillis = Date.UTC(year, month - 1, day, hour - BANGKOK_UTC_OFFSET_HOURS, minute);
  const result = new Date(utcMillis);

  if (Number.isNaN(result.getTime()) || !isSameBangkokDateTime(result, date, time)) {
    throw new Error('Invalid Bangkok date or time');
  }

  return result;
}

export function getBangkokWeekStart(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const current = new Date(Date.UTC(year, month - 1, day));
  const daysFromMonday = (current.getUTCDay() + 6) % 7;
  current.setUTCDate(current.getUTCDate() - daysFromMonday);
  return formatDateInput(current);
}

export function shiftBangkokWeek(date: string, weeks: number): string {
  const current = bangkokDateTimeToUtc(date, '00:00');
  current.setUTCDate(current.getUTCDate() + weeks * 7);
  return formatDateInput(new Date(current.getTime() + BANGKOK_UTC_OFFSET_HOURS * 60 * 60 * 1000));
}

export function getBangkokWeekRange(weekStart: string): { from: string; to: string } {
  const from = bangkokDateTimeToUtc(weekStart, '00:00');
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function formatBangkokDate(value: string | Date, language: 'en' | 'th'): string {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: BANGKOK_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatBangkokTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: BANGKOK_TIME_ZONE,
    hour12: false,
  }).format(new Date(value));
}

export function getDurationHours(startAtUtc: string, endAtUtc: string): number {
  return (new Date(endAtUtc).getTime() - new Date(startAtUtc).getTime()) / (60 * 60 * 1000);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function formatDateInput(date: Date): string {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) =>
      index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'),
    )
    .join('-');
}

function isSameBangkokDateTime(value: Date, date: string, time: string): boolean {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(value);
  const parts = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return (
    `${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time
  );
}

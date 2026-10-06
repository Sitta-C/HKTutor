'use client';

import { CalendarRuler } from '@/components/date-time/calendar-ruler';

import type { DateTimeLanguage } from '@/lib/date-time';

export function WeekRuler(props: {
  value: string;
  language: DateTimeLanguage;
  label: string;
  hint: string;
  selectedLabel: string;
  onChange: (weekStart: string) => void;
}) {
  return <CalendarRuler unit="week" {...props} />;
}

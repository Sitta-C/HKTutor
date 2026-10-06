'use client';

import { CalendarRuler } from '@/components/date-time/calendar-ruler';

import type { DateTimeLanguage } from '@/lib/date-time';

export function MonthRuler(props: {
  value: string;
  language: DateTimeLanguage;
  label: string;
  hint: string;
  selectedLabel: string;
  onChange: (month: string) => void;
}) {
  return <CalendarRuler unit="month" {...props} />;
}

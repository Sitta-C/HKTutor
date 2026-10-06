'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { notebookInputClass } from '@/components/ui/notebook';
import {
  addIsoDays,
  formatCalendarDate,
  formatCalendarMonth,
  getBangkokToday,
  getCalendarLocale,
  getCalendarMonthDays,
  getCalendarWeekdayLabels,
  getMondayBasedWeekday,
  shiftIsoMonth,
  startOfIsoMonth,
} from '@/lib/date-time';

import type { DateTimeLanguage } from '@/lib/date-time';

interface LocalizedDatePickerProps {
  value: string;
  name?: string;
  min?: string;
  language: DateTimeLanguage;
  label: string;
  calendarLabel: string;
  previousMonthLabel: string;
  nextMonthLabel: string;
  onChange: (value: string) => void;
}

export function LocalizedDatePicker({
  value,
  name = 'date',
  min,
  language,
  label,
  calendarLabel,
  previousMonthLabel,
  nextMonthLabel,
  onChange,
}: LocalizedDatePickerProps) {
  const labelId = useId();
  const valueId = useId();
  const dialogId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeDayRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfIsoMonth(value));
  const [activeDate, setActiveDate] = useState(value);

  const days = useMemo(() => getCalendarMonthDays(viewMonth), [viewMonth]);
  const weekdayLabels = useMemo(() => getCalendarWeekdayLabels(language), [language]);
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(getCalendarLocale(language), { useGrouping: false }),
    [language],
  );
  const previousMonthDisabled = Boolean(min && addIsoDays(viewMonth, -1) < min);
  const today = getBangkokToday();

  useEffect(() => {
    if (isOpen) activeDayRef.current?.focus();
  }, [activeDate, isOpen, viewMonth]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen]);

  const openCalendar = () => {
    const nextActiveDate = min && value < min ? min : value;
    setActiveDate(nextActiveDate);
    setViewMonth(startOfIsoMonth(nextActiveDate));
    setIsOpen(true);
  };

  const closeCalendar = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const selectDate = (nextDate: string) => {
    if (min && nextDate < min) return;
    onChange(nextDate);
    setActiveDate(nextDate);
    closeCalendar();
  };

  const moveActiveDate = (nextDate: string) => {
    const allowedDate = min && nextDate < min ? min : nextDate;
    setActiveDate(allowedDate);
    setViewMonth(startOfIsoMonth(allowedDate));
  };

  const moveMonth = (months: number) => {
    if (months < 0 && previousMonthDisabled) return;
    moveActiveDate(shiftIsoMonth(activeDate, months));
  };

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextDate: string | null = null;
    if (event.key === 'ArrowLeft') nextDate = addIsoDays(activeDate, -1);
    if (event.key === 'ArrowRight') nextDate = addIsoDays(activeDate, 1);
    if (event.key === 'ArrowUp') nextDate = addIsoDays(activeDate, -7);
    if (event.key === 'ArrowDown') nextDate = addIsoDays(activeDate, 7);
    if (event.key === 'Home') {
      nextDate = addIsoDays(activeDate, -getMondayBasedWeekday(activeDate));
    }
    if (event.key === 'End') {
      nextDate = addIsoDays(activeDate, 6 - getMondayBasedWeekday(activeDate));
    }
    if (event.key === 'PageUp') nextDate = shiftIsoMonth(activeDate, -1);
    if (event.key === 'PageDown') nextDate = shiftIsoMonth(activeDate, 1);

    if (nextDate) {
      event.preventDefault();
      moveActiveDate(nextDate);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectDate(activeDate);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCalendar();
    }
  };

  return (
    <div
      className="relative flex flex-col gap-1.5 text-sm font-bold text-notebook-ink"
      ref={rootRef}
    >
      <span id={labelId}>{label}</span>
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        type="button"
        className={notebookInputClass({
          className:
            'flex cursor-pointer items-center justify-between gap-3 text-left focus:border-tutor focus:ring-sticky-blue/70',
        })}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={dialogId}
        onClick={() => (isOpen ? closeCalendar() : openCalendar())}
      >
        <span id={valueId}>{formatCalendarDate(value, language)}</span>
        <CalendarIcon />
      </button>

      {isOpen && (
        <div
          id={dialogId}
          className="absolute left-0 top-[calc(100%+0.55rem)] z-30 w-full min-w-0 rounded-2xl border border-paper-edge bg-paper p-4 text-notebook-ink shadow-paper"
          role="dialog"
          aria-label={calendarLabel}
        >
          <div className="mb-3 grid grid-cols-[2.35rem_minmax(0,1fr)_2.35rem] items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-edge bg-paper-deep text-lg text-notebook-ink transition hover:bg-sticky-blue/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor/40 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={previousMonthLabel}
              disabled={previousMonthDisabled}
              onClick={() => moveMonth(-1)}
            >
              ‹
            </button>
            <strong className="text-center text-sm font-extrabold" aria-live="polite">
              {formatCalendarMonth(viewMonth, language)}
            </strong>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-edge bg-paper-deep text-lg text-notebook-ink transition hover:bg-sticky-blue/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor/40 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={nextMonthLabel}
              onClick={() => moveMonth(1)}
            >
              ›
            </button>
          </div>

          <div
            role="grid"
            aria-label={formatCalendarMonth(viewMonth, language)}
            onKeyDown={handleGridKeyDown}
          >
            <div className="mb-1 grid grid-cols-7 gap-1" role="row">
              {weekdayLabels.map((weekday) => (
                <span
                  key={weekday}
                  className="py-1 text-center text-[0.64rem] font-bold text-notebook-muted"
                  role="columnheader"
                  aria-label={weekday}
                >
                  {weekday}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1" role="rowgroup">
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div className="grid grid-cols-7 gap-1" role="row" key={weekIndex}>
                  {days.slice(weekIndex * 7, weekIndex * 7 + 7).map((day) => {
                    const disabled = Boolean(min && day.isoDate < min);
                    const selected = day.isoDate === value;
                    const active = day.isoDate === activeDate;
                    return (
                      <button
                        key={day.isoDate}
                        ref={active ? activeDayRef : undefined}
                        type="button"
                        role="gridcell"
                        className={`inline-flex aspect-square min-w-0 items-center justify-center rounded-lg text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor/40 disabled:cursor-not-allowed disabled:text-notebook-muted disabled:opacity-30 disabled:line-through ${
                          day.inCurrentMonth
                            ? 'text-notebook-ink'
                            : 'text-notebook-muted opacity-60'
                        } ${
                          selected
                            ? 'bg-tutor-deep text-white hover:bg-tutor-deep'
                            : 'hover:bg-sticky-blue/60'
                        } ${day.isoDate === today && !selected ? 'ring-1 ring-inset ring-tutor' : ''}`}
                        aria-label={formatCalendarDate(day.isoDate, language)}
                        aria-selected={selected}
                        aria-current={day.isoDate === today ? 'date' : undefined}
                        disabled={disabled}
                        tabIndex={active ? 0 : -1}
                        onClick={() => selectDate(day.isoDate)}
                      >
                        {numberFormatter.format(day.day)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[1.15rem] w-[1.15rem] shrink-0"
      aria-hidden="true"
    >
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M8 3.5v4M16 3.5v4M3.5 10h17" />
    </svg>
  );
}

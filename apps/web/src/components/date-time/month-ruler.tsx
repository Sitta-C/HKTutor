'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { getCalendarLocale, parseIsoDate, shiftIsoMonth } from '@/lib/date-time';

import styles from './month-ruler.module.css';

import type { DateTimeLanguage } from '@/lib/date-time';
import type { KeyboardEvent } from 'react';

const MONTHS_EACH_SIDE = 12;
const SETTLE_DELAY_MS = 180;

function centerMonth(track: HTMLDivElement, month: string, smooth = false): void {
  const button = track.querySelector<HTMLButtonElement>(`[data-month="${month}"]`);
  if (!button || track.clientWidth === 0) return;
  track.scrollTo({
    left: button.offsetLeft - (track.clientWidth - button.offsetWidth) / 2,
    behavior:
      smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'instant',
  });
}

export function MonthRuler({
  value,
  language,
  label,
  hint,
  selectedLabel,
  onChange,
}: {
  value: string;
  language: DateTimeLanguage;
  label: string;
  hint: string;
  selectedLabel: string;
  onChange: (month: string) => void;
}) {
  const hintId = useId();
  const [anchor, setAnchor] = useState(value);
  const trackRef = useRef<HTMLDivElement>(null);
  const smoothRef = useRef(false);
  const focusMonthRef = useRef<string | null>(null);
  const targetMonthRef = useRef<string | null>(null);
  const rangeAnchorRef = useRef(value);
  const first = shiftIsoMonth(`${anchor}-01`, -MONTHS_EACH_SIDE).slice(0, 7);
  const last = shiftIsoMonth(`${anchor}-01`, MONTHS_EACH_SIDE).slice(0, 7);
  const visibleAnchor = value < first || value > last ? value : anchor;
  const months = useMemo(() => {
    const locale = getCalendarLocale(language);
    const short = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const year = new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' });
    return Array.from({ length: MONTHS_EACH_SIDE * 2 + 1 }, (_, index) => {
      const date = shiftIsoMonth(`${visibleAnchor}-01`, index - MONTHS_EACH_SIDE);
      const parsed = parseIsoDate(date);
      return {
        value: date.slice(0, 7),
        short: short.format(parsed),
        label: long.format(parsed),
        year: year.format(parsed),
      };
    });
  }, [language, visibleAnchor]);
  const selected = months.find((month) => month.value === value);
  const windowStart = months[1]?.value ?? value;
  const windowEnd = months[months.length - 2]?.value ?? value;
  const commitMonth = useCallback(
    (next: string) => {
      // Replenish the ends only after selection, keeping a bounded number of month buttons.
      if (next <= windowStart || next >= windowEnd) setAnchor(next);
      onChange(next);
    },
    [onChange, windowEnd, windowStart],
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let drag: { pointerId: number; x: number; left: number; moved: boolean } | null = null;
    let suppressClick = false;
    const nearestMonth = () => {
      const middle = track.scrollLeft + track.clientWidth / 2;
      let nearest: HTMLButtonElement | undefined;
      let distance = Infinity;
      for (const button of track.querySelectorAll<HTMLButtonElement>('[data-month]')) {
        const nextDistance = Math.abs(button.offsetLeft + button.offsetWidth / 2 - middle);
        if (nextDistance < distance) {
          distance = nextDistance;
          nearest = button;
        }
      }
      return nearest?.dataset.month;
    };
    const settle = () => {
      clearTimeout(settleTimer);
      if (drag || track.clientWidth === 0) return;
      // Canceled smooth scrolls can emit scrollend while a new selection is being centered.
      if (targetMonthRef.current) {
        if (targetMonthRef.current === value) {
          targetMonthRef.current = null;
          centerMonth(track, value);
        }
        return;
      }
      const next = nearestMonth();
      if (next && next !== value) commitMonth(next);
    };
    const scheduleSettle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
    };
    const startDrag = (event: PointerEvent) => {
      targetMonthRef.current = null;
      // Touch and trackpad momentum remain native. Only a mouse drag needs extra handling.
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (event.clientY > track.getBoundingClientRect().bottom - 10) return;
      drag = { pointerId: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
    };
    const cancelUnmovedDrag = () => {
      if (drag && !drag.moved) drag = null;
    };
    const interruptSelection = () => {
      targetMonthRef.current = null;
    };
    const moveDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId || event.buttons !== 1) return;
      const offset = event.clientX - drag.x;
      if (!drag.moved && Math.abs(offset) <= 5) return;
      drag.moved = true;
      track.style.scrollSnapType = 'none';
      track.setPointerCapture(event.pointerId);
      track.scrollLeft = drag.left - offset;
    };
    const finishDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved;
      drag = null;
      if (!moved) return;
      suppressClick = true;
      clickTimer = setTimeout(() => {
        suppressClick = false;
      }, 0);
      track.style.scrollSnapType = '';
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      const next = nearestMonth();
      if (next) centerMonth(track, next, true);
      scheduleSettle();
    };
    const preventDragClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };
    targetMonthRef.current = value;
    // Changing the loaded range changes coordinates, so only animate within the same range.
    centerMonth(track, value, smoothRef.current && rangeAnchorRef.current === visibleAnchor);
    rangeAnchorRef.current = visibleAnchor;
    smoothRef.current = false;
    if (focusMonthRef.current) {
      track
        .querySelector<HTMLButtonElement>(`[data-month="${focusMonthRef.current}"]`)
        ?.focus({ preventScroll: true });
      focusMonthRef.current = null;
    }
    let previousWidth = track.clientWidth;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth !== previousWidth) {
        previousWidth = track.clientWidth;
        targetMonthRef.current = value;
        centerMonth(track, value);
      }
    });
    observer.observe(track);
    track.addEventListener('scroll', scheduleSettle, { passive: true });
    track.addEventListener('scrollend', settle);
    track.addEventListener('pointerdown', startDrag);
    track.addEventListener('pointermove', moveDrag);
    track.addEventListener('pointerleave', cancelUnmovedDrag);
    track.addEventListener('pointerup', finishDrag);
    track.addEventListener('pointercancel', finishDrag);
    track.addEventListener('click', preventDragClick, true);
    track.addEventListener('wheel', interruptSelection, { passive: true });
    return () => {
      clearTimeout(settleTimer);
      clearTimeout(clickTimer);
      observer.disconnect();
      track.style.scrollSnapType = '';
      track.removeEventListener('scroll', scheduleSettle);
      track.removeEventListener('scrollend', settle);
      track.removeEventListener('pointerdown', startDrag);
      track.removeEventListener('pointermove', moveDrag);
      track.removeEventListener('pointerleave', cancelUnmovedDrag);
      track.removeEventListener('pointerup', finishDrag);
      track.removeEventListener('pointercancel', finishDrag);
      track.removeEventListener('click', preventDragClick, true);
      track.removeEventListener('wheel', interruptSelection);
    };
  }, [commitMonth, months, value, visibleAnchor]);

  const chooseMonth = (next: string, focus = false) => {
    smoothRef.current = true;
    targetMonthRef.current = next;
    if (focus) focusMonthRef.current = next;
    if (next === value && trackRef.current) centerMonth(trackRef.current, next, true);
    commitMonth(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, month: string) => {
    let next: string | undefined;
    if (event.key === 'ArrowLeft') next = shiftIsoMonth(`${month}-01`, -1).slice(0, 7);
    if (event.key === 'ArrowRight') next = shiftIsoMonth(`${month}-01`, 1).slice(0, 7);
    if (event.key === 'PageUp') next = shiftIsoMonth(`${month}-01`, -12).slice(0, 7);
    if (event.key === 'PageDown') next = shiftIsoMonth(`${month}-01`, 12).slice(0, 7);
    if (event.key === 'Home') next = months[0]?.value;
    if (event.key === 'End') next = months[months.length - 1]?.value;
    if (!next) return;
    event.preventDefault();
    chooseMonth(next, true);
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={hintId}
      className="w-full min-w-0 rounded-xl border border-paper-edge bg-white shadow-[0_2px_0_#ddd6c72e] sm:w-[26rem]"
    >
      <span id={hintId} className="sr-only">
        {hint}
      </span>
      <div className={`${styles.window} relative`}>
        <span aria-hidden="true" className={styles.pointer} />
        <div
          ref={trackRef}
          data-month-track
          className={`${styles.track} relative flex min-w-0 select-none overflow-x-auto`}
        >
          {months.map((month) => (
            <button
              key={month.value}
              type="button"
              data-month={month.value}
              aria-label={month.label}
              aria-pressed={month.value === value}
              tabIndex={month.value === value ? 0 : -1}
              onClick={() => chooseMonth(month.value)}
              onKeyDown={(event) => handleKeyDown(event, month.value)}
              className={`${styles.month} cursor-pointer rounded-lg px-3 py-0.5 text-center transition-colors duration-150 hover:bg-sticky-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tutor-deep motion-reduce:transition-none ${month.value === value ? 'bg-[color-mix(in_srgb,var(--color-tutor-deep)_9%,white)] text-tutor-deep' : 'text-notebook-muted'}`}
            >
              <span className="block text-sm font-semibold">{month.short}</span>
              <span className="mt-0.5 block text-xs tabular-nums">{month.year}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sr-only">
        <span>{selectedLabel}</span>
        <p role="status">{selected?.label}</p>
      </div>
    </div>
  );
}

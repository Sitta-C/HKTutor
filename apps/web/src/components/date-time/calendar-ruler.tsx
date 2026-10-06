'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  buildRulerItems,
  RULER_ITEMS_EACH_SIDE,
  shiftRulerValue,
} from '@/components/date-time/calendar-ruler-model';

import styles from './calendar-ruler.module.css';

import type { CalendarRulerUnit } from '@/components/date-time/calendar-ruler-model';
import type { DateTimeLanguage } from '@/lib/date-time';
import type { KeyboardEvent } from 'react';

const SETTLE_DELAY_MS = 180;

function centerItem(track: HTMLDivElement, itemValue: string, smooth = false): void {
  const button = track.querySelector<HTMLButtonElement>(`[data-ruler-item="${itemValue}"]`);
  if (!button || track.clientWidth === 0) return;
  track.scrollTo({
    left: button.offsetLeft - (track.clientWidth - button.offsetWidth) / 2,
    behavior:
      smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'instant',
  });
}

export function CalendarRuler({
  unit,
  value,
  language,
  label,
  hint,
  selectedLabel,
  onChange,
}: {
  unit: CalendarRulerUnit;
  value: string;
  language: DateTimeLanguage;
  label: string;
  hint: string;
  selectedLabel: string;
  onChange: (value: string) => void;
}) {
  const hintId = useId();
  const [anchor, setAnchor] = useState(value);
  const trackRef = useRef<HTMLDivElement>(null);
  const smoothRef = useRef(false);
  const focusItemRef = useRef<string | null>(null);
  const targetItemRef = useRef<string | null>(null);
  const rangeAnchorRef = useRef(value);
  const first = shiftRulerValue(anchor, unit, -RULER_ITEMS_EACH_SIDE);
  const last = shiftRulerValue(anchor, unit, RULER_ITEMS_EACH_SIDE);
  const visibleAnchor = value < first || value > last ? value : anchor;
  const items = useMemo(
    () => buildRulerItems(visibleAnchor, unit, language),
    [language, unit, visibleAnchor],
  );
  const selected = items.find((item) => item.value === value);
  const windowStart = items[1]?.value ?? value;
  const windowEnd = items[items.length - 2]?.value ?? value;
  const commitItem = useCallback(
    (next: string) => {
      // Replenish the ends only after selection, keeping a bounded number of items.
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
    let touchIsActive = false;
    let suppressClick = false;
    const nearestItem = () => {
      const middle = track.scrollLeft + track.clientWidth / 2;
      let nearest: HTMLButtonElement | undefined;
      let distance = Infinity;
      for (const button of track.querySelectorAll<HTMLButtonElement>('[data-ruler-item]')) {
        const nextDistance = Math.abs(button.offsetLeft + button.offsetWidth / 2 - middle);
        if (nextDistance < distance) {
          distance = nextDistance;
          nearest = button;
        }
      }
      return nearest?.dataset.rulerItem;
    };
    const settle = () => {
      clearTimeout(settleTimer);
      if (drag || touchIsActive || track.clientWidth === 0) return;
      // Canceled smooth scrolls can emit scrollend while a new selection is being centered.
      if (targetItemRef.current) {
        if (targetItemRef.current === value) {
          targetItemRef.current = null;
          centerItem(track, value);
        }
        return;
      }
      const next = nearestItem();
      if (next && next !== value) commitItem(next);
    };
    const scheduleSettle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
    };
    const startDrag = (event: PointerEvent) => {
      targetItemRef.current = null;
      // Touch and trackpad momentum remain native. Only a mouse drag needs extra handling.
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (event.clientY > track.getBoundingClientRect().bottom - 10) return;
      drag = { pointerId: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
    };
    const cancelUnmovedDrag = () => {
      if (drag && !drag.moved) drag = null;
    };
    const interruptSelection = () => {
      targetItemRef.current = null;
    };
    const startTouch = () => {
      touchIsActive = true;
      targetItemRef.current = null;
    };
    const finishTouch = (event: TouchEvent) => {
      touchIsActive = event.touches.length > 0;
      if (!touchIsActive) scheduleSettle();
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
      const next = nearestItem();
      if (next) centerItem(track, next, true);
      scheduleSettle();
    };
    const preventDragClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };
    targetItemRef.current = value;
    // Changing the loaded range changes coordinates, so only animate within the same range.
    centerItem(track, value, smoothRef.current && rangeAnchorRef.current === visibleAnchor);
    rangeAnchorRef.current = visibleAnchor;
    smoothRef.current = false;
    if (focusItemRef.current) {
      track
        .querySelector<HTMLButtonElement>(`[data-ruler-item="${focusItemRef.current}"]`)
        ?.focus({ preventScroll: true });
      focusItemRef.current = null;
    }
    let previousWidth = track.clientWidth;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth !== previousWidth) {
        previousWidth = track.clientWidth;
        targetItemRef.current = value;
        centerItem(track, value);
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
    // Native panning cancels pointer events before the finger lifts, so track touch completion.
    track.addEventListener('touchstart', startTouch, { passive: true });
    track.addEventListener('touchend', finishTouch, { passive: true });
    track.addEventListener('touchcancel', finishTouch, { passive: true });
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
      track.removeEventListener('touchstart', startTouch);
      track.removeEventListener('touchend', finishTouch);
      track.removeEventListener('touchcancel', finishTouch);
      track.removeEventListener('click', preventDragClick, true);
      track.removeEventListener('wheel', interruptSelection);
    };
  }, [commitItem, items, value, visibleAnchor]);

  const chooseItem = (next: string, focus = false) => {
    smoothRef.current = true;
    targetItemRef.current = next;
    if (focus) focusItemRef.current = next;
    if (next === value && trackRef.current) centerItem(trackRef.current, next, true);
    commitItem(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, itemValue: string) => {
    let next: string | undefined;
    if (event.key === 'ArrowLeft') next = shiftRulerValue(itemValue, unit, -1);
    if (event.key === 'ArrowRight') next = shiftRulerValue(itemValue, unit, 1);
    if (event.key === 'PageUp')
      next = shiftRulerValue(itemValue, unit, unit === 'month' ? -12 : -4);
    if (event.key === 'PageDown')
      next = shiftRulerValue(itemValue, unit, unit === 'month' ? 12 : 4);
    if (event.key === 'Home') next = items[0]?.value;
    if (event.key === 'End') next = items[items.length - 1]?.value;
    if (!next) return;
    event.preventDefault();
    chooseItem(next, true);
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={hintId}
      className={`w-full min-w-0 rounded-xl border border-paper-edge bg-white shadow-[0_2px_0_#ddd6c72e] ${unit === 'month' ? 'sm:w-[26rem]' : 'max-w-[26rem]'}`}
    >
      <span id={hintId} className="sr-only">
        {hint}
      </span>
      <div className={`${styles.window} ${unit === 'week' ? styles.weekWindow : ''} relative`}>
        <span aria-hidden="true" className={styles.pointer} />
        <div
          ref={trackRef}
          data-month-track={unit === 'month' ? true : undefined}
          data-week-track={unit === 'week' ? true : undefined}
          className={`${styles.track} relative flex min-w-0 select-none overflow-x-auto`}
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              data-ruler-item={item.value}
              data-month={unit === 'month' ? item.value : undefined}
              data-week={unit === 'week' ? item.value : undefined}
              aria-label={item.label}
              aria-pressed={item.value === value}
              tabIndex={item.value === value ? 0 : -1}
              onClick={() => chooseItem(item.value)}
              onKeyDown={(event) => handleKeyDown(event, item.value)}
              className={`${styles.item} cursor-pointer rounded-lg px-3 py-0.5 text-center transition-colors duration-150 hover:bg-sticky-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-tutor-deep motion-reduce:transition-none ${item.value === value ? 'bg-[color-mix(in_srgb,var(--color-tutor-deep)_9%,white)] text-tutor-deep' : 'text-notebook-muted'}`}
            >
              <span className="block text-sm font-semibold">{item.title}</span>
              <span className="mt-0.5 block whitespace-nowrap text-xs tabular-nums">
                {item.subtitle}
              </span>
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

'use client';

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import { notebookInputClass } from '@/components/ui/notebook';

import styles from './time-wheel-picker.module.css';

const ROW_HEIGHT = 44;
const SETTLE_DELAY_MS = 160;

function wheelValue(track: HTMLDivElement, count: number): number {
  return ((Math.round(track.scrollTop / ROW_HEIGHT) % count) + count) % count;
}

function centerValue(track: HTMLDivElement, value: number, count: number): void {
  track.scrollTo({ top: (count * 2 + value) * ROW_HEIGHT, left: 0, behavior: 'instant' });
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function TimeWheelPicker({
  value,
  name,
  label,
  hourLabel,
  minuteLabel,
  onChange,
}: {
  value: string;
  name: string;
  label: string;
  hourLabel: string;
  minuteLabel: string;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  const valueId = useId();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  const changeHour = useCallback(
    (next: number) => onChange(`${twoDigits(next)}:${twoDigits(minute)}`),
    [minute, onChange],
  );
  const changeMinute = useCallback(
    (next: number) => onChange(`${twoDigits(hour)}:${twoDigits(next)}`),
    [hour, onChange],
  );
  const commitTime = useCallback(() => {
    // Read both columns together so closing immediately after a gesture keeps the visible time.
    if (isOpen && hourRef.current && minuteRef.current) {
      onChange(
        `${twoDigits(wheelValue(hourRef.current, 24))}:${twoDigits(wheelValue(minuteRef.current, 60))}`,
      );
    }
  }, [isOpen, onChange]);
  const closePicker = useCallback(() => {
    commitTime();
    setIsOpen(false);
  }, [commitTime]);

  useEffect(() => {
    if (!isOpen) return;
    hourRef.current?.focus({ preventScroll: true });
    const commitOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) commitTime();
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePicker();
    };
    // Keep the clicked control in place until its click completes, while saving the time early.
    document.addEventListener('pointerdown', commitOnOutsidePointer);
    document.addEventListener('click', closeOnOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', commitOnOutsidePointer);
      document.removeEventListener('click', closeOnOutsideClick);
    };
  }, [closePicker, commitTime, isOpen]);

  return (
    <div
      ref={rootRef}
      className="min-w-0 text-sm font-bold text-notebook-ink"
      onKeyDown={(event) => {
        if (isOpen && (event.key === 'Escape' || event.key === 'Enter')) {
          event.preventDefault();
          closePicker();
          triggerRef.current?.focus();
        }
      }}
    >
      <span id={labelId} className="mb-1.5 block">
        {label}
      </span>
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        type="button"
        className={notebookInputClass({
          className:
            'flex cursor-pointer items-center justify-between gap-3 text-left tabular-nums focus:border-tutor focus:ring-sticky-blue/70',
        })}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => (isOpen ? closePicker() : setIsOpen(true))}
      >
        <span id={valueId}>{value}</span>
        <span aria-hidden="true" className={`${styles.chevron} ${isOpen ? styles.rotated : ''}`}>
          ⌄
        </span>
      </button>
      <div
        id={panelId}
        className={styles.panel}
        data-open={isOpen}
        role="group"
        aria-label={label}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div className={styles.panelContent}>
          <div className="mt-2 rounded-2xl border border-paper-edge bg-paper px-3 pb-3 pt-3 shadow-paper">
            <div className="mb-1 grid grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] text-center text-xs font-semibold text-notebook-muted">
              <span>{hourLabel}</span>
              <span />
              <span>{minuteLabel}</span>
            </div>
            <div className={styles.wheels}>
              <span className={styles.selection} aria-hidden="true" />
              <TimeWheel
                trackRef={hourRef}
                value={hour}
                count={24}
                label={hourLabel}
                isOpen={isOpen}
                onChange={changeHour}
              />
              <span className="relative text-center text-2xl" aria-hidden="true">
                :
              </span>
              <TimeWheel
                trackRef={minuteRef}
                value={minute}
                count={60}
                label={minuteLabel}
                isOpen={isOpen}
                onChange={changeMinute}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimeWheel({
  trackRef,
  value,
  count,
  label,
  isOpen,
  onChange,
}: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  value: number;
  count: number;
  label: string;
  isOpen: boolean;
  onChange: (value: number) => void;
}) {
  const commitValue = useEffectEvent((next: number) => onChange(next));

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !isOpen) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let drag: { pointerId: number; y: number; top: number; moved: boolean } | null = null;
    let suppressClick = false;
    let targetTop: number | null = (count * 2 + value) * ROW_HEIGHT;
    centerValue(track, value, count);

    const settle = () => {
      clearTimeout(settleTimer);
      if (drag || targetTop !== null) return;
      const next = wheelValue(track, count);
      // Recenter repeated values to keep 23→00 and 59→00 scrolling seamless.
      targetTop = (count * 2 + next) * ROW_HEIGHT;
      centerValue(track, next, count);
      if (next !== value) commitValue(next);
    };
    const scheduleSettle = () => {
      clearTimeout(settleTimer);
      if (targetTop !== null && Math.abs(track.scrollTop - targetTop) < 1) {
        targetTop = null;
        return;
      }
      settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
    };
    const handleWheel = (event: WheelEvent) => {
      targetTop = null;
      if (event.deltaX !== 0) {
        // Cancel horizontal/diagonal panning but keep the gesture's vertical movement.
        event.preventDefault();
        const scale =
          event.deltaMode === 1 ? ROW_HEIGHT : event.deltaMode === 2 ? ROW_HEIGHT * 3 : 1;
        track.scrollTop += event.deltaY * scale;
      }
    };
    const startDrag = (event: PointerEvent) => {
      targetTop = null;
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (event.clientX - track.getBoundingClientRect().left >= track.clientWidth) return;
      clearTimeout(settleTimer);
      drag = { pointerId: event.pointerId, y: event.clientY, top: track.scrollTop, moved: false };
    };
    const moveDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId || event.buttons !== 1) return;
      const offset = event.clientY - drag.y;
      if (!drag.moved && Math.abs(offset) <= 5) return;
      drag.moved = true;
      track.style.scrollSnapType = 'none';
      track.setPointerCapture(event.pointerId);
      event.preventDefault();
      track.scrollTop = drag.top - offset;
    };
    const finishDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved;
      drag = null;
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      track.style.scrollSnapType = '';
      if (!moved) return;
      suppressClick = true;
      clickTimer = setTimeout(() => {
        suppressClick = false;
      }, 0);
      settle();
    };
    const cancelUnmovedDrag = () => {
      if (drag && !drag.moved) drag = null;
    };
    const chooseValue = (next: number) => {
      clearTimeout(settleTimer);
      targetTop = (count * 2 + next) * ROW_HEIGHT;
      centerValue(track, next, count);
      commitValue(next);
      track.focus({ preventScroll: true });
    };
    const handleClick = (event: MouseEvent) => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
        return;
      }
      const option =
        event.target instanceof Element ? event.target.closest('[data-wheel-value]') : null;
      if (option instanceof HTMLElement) chooseValue(Number(option.dataset.wheelValue));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      let next: number | undefined;
      if (event.key === 'ArrowUp') next = (value + count - 1) % count;
      if (event.key === 'ArrowDown') next = (value + 1) % count;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = count - 1;
      if (event.key === 'PageUp') next = (value + count - 5) % count;
      if (event.key === 'PageDown') next = (value + 5) % count;
      if (next === undefined) return;
      event.preventDefault();
      chooseValue(next);
    };
    track.addEventListener('scroll', scheduleSettle, { passive: true });
    track.addEventListener('scrollend', settle);
    track.addEventListener('wheel', handleWheel, { passive: false });
    track.addEventListener('pointerdown', startDrag);
    track.addEventListener('pointermove', moveDrag);
    track.addEventListener('pointerup', finishDrag);
    track.addEventListener('pointercancel', finishDrag);
    track.addEventListener('lostpointercapture', finishDrag);
    track.addEventListener('pointerleave', cancelUnmovedDrag);
    track.addEventListener('click', handleClick);
    track.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(settleTimer);
      clearTimeout(clickTimer);
      track.style.scrollSnapType = '';
      track.removeEventListener('scroll', scheduleSettle);
      track.removeEventListener('scrollend', settle);
      track.removeEventListener('wheel', handleWheel);
      track.removeEventListener('pointerdown', startDrag);
      track.removeEventListener('pointermove', moveDrag);
      track.removeEventListener('pointerup', finishDrag);
      track.removeEventListener('pointercancel', finishDrag);
      track.removeEventListener('lostpointercapture', finishDrag);
      track.removeEventListener('pointerleave', cancelUnmovedDrag);
      track.removeEventListener('click', handleClick);
      track.removeEventListener('keydown', handleKeyDown);
    };
  }, [count, isOpen, trackRef, value]);

  return (
    <div
      ref={trackRef}
      className={styles.track}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={value}
      aria-valuetext={twoDigits(value)}
    >
      {Array.from({ length: count * 5 }, (_, index) => (
        <span
          key={index}
          data-wheel-value={index % count}
          aria-hidden="true"
          className={index === count * 2 + value ? styles.selected : styles.option}
        >
          {twoDigits(index % count)}
        </span>
      ))}
    </div>
  );
}

'use client';

import { useEffect, useId, useMemo, useRef } from 'react';

import { publicTutorDetailCopy } from '@/components/tutors/public-tutor-detail-copy';

import styles from './public-tutor-course-ruler.module.css';

import type { KeyboardEvent } from 'react';

const SETTLE_DELAY_MS = 180;

function centerPage(track: HTMLDivElement, page: number, smooth = false): void {
  const button = track.querySelector<HTMLButtonElement>(`[data-course-page="${page}"]`);
  if (!button || track.clientWidth === 0) return;
  track.scrollTo({
    left: button.offsetLeft - (track.clientWidth - button.offsetWidth) / 2,
    behavior:
      smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'instant',
  });
}

// The calendar ruler's scroll/drag pattern, bounded to pages of already loaded courses.
export function PublicTutorCourseRuler({
  page,
  pageSize,
  total,
  language,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  language: 'th' | 'en';
  onChange: (page: number) => void;
}) {
  const hintId = useId();
  const text = publicTutorDetailCopy[language];
  const pageCount = Math.ceil(total / pageSize);
  const items = useMemo(
    () =>
      Array.from({ length: pageCount }, (_, index) => ({
        page: index + 1,
        range: `${index * pageSize + 1}–${Math.min((index + 1) * pageSize, total)}`,
      })),
    [pageCount, pageSize, total],
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const smoothRef = useRef(false);
  const focusPageRef = useRef<number | null>(null);
  const targetPageRef = useRef<number | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;
    let drag: { pointerId: number; x: number; left: number; moved: boolean } | null = null;
    let touching = false;
    let suppressClick = false;
    const nearestPage = () => {
      const middle = track.scrollLeft + track.clientWidth / 2;
      let nearest: HTMLButtonElement | undefined;
      let distance = Infinity;
      for (const button of track.querySelectorAll<HTMLButtonElement>('[data-course-page]')) {
        const nextDistance = Math.abs(button.offsetLeft + button.offsetWidth / 2 - middle);
        if (nextDistance < distance) {
          distance = nextDistance;
          nearest = button;
        }
      }
      return nearest ? Number(nearest.dataset.coursePage) : null;
    };
    const settle = () => {
      clearTimeout(settleTimer);
      if (drag || touching || track.clientWidth === 0) return;
      // Ignore an old scrollend emitted while a clicked page is being centered.
      if (targetPageRef.current !== null) {
        if (targetPageRef.current === page) {
          targetPageRef.current = null;
          centerPage(track, page);
        }
        return;
      }
      const next = nearestPage();
      if (next !== null && next !== page) onChange(next);
    };
    const scheduleSettle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
    };
    const interruptSelection = () => {
      targetPageRef.current = null;
    };
    const startDrag = (event: PointerEvent) => {
      interruptSelection();
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (event.clientY > track.getBoundingClientRect().bottom - 10) return;
      drag = { pointerId: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
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
    const cancelUnmovedDrag = () => {
      if (drag && !drag.moved) drag = null;
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
      const next = nearestPage();
      if (next !== null) centerPage(track, next, true);
      scheduleSettle();
    };
    const preventDragClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };
    const startTouch = () => {
      touching = true;
      interruptSelection();
    };
    const finishTouch = (event: TouchEvent) => {
      touching = event.touches.length > 0;
      if (!touching) scheduleSettle();
    };
    targetPageRef.current = page;
    centerPage(track, page, smoothRef.current);
    smoothRef.current = false;
    if (focusPageRef.current !== null) {
      track
        .querySelector<HTMLButtonElement>(`[data-course-page="${focusPageRef.current}"]`)
        ?.focus({ preventScroll: true });
      focusPageRef.current = null;
    }
    let previousWidth = track.clientWidth;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth !== previousWidth) {
        previousWidth = track.clientWidth;
        targetPageRef.current = page;
        centerPage(track, page);
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
  }, [items, onChange, page]);

  const choosePage = (next: number, focus = false) => {
    smoothRef.current = true;
    targetPageRef.current = next;
    if (focus) focusPageRef.current = next;
    if (next === page && trackRef.current) {
      centerPage(trackRef.current, next, true);
      if (focus) {
        trackRef.current.querySelector<HTMLButtonElement>(`[data-course-page="${next}"]`)?.focus();
        focusPageRef.current = null;
      }
    }
    onChange(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, itemPage: number) => {
    let next: number | undefined;
    if (event.key === 'ArrowLeft') next = Math.max(1, itemPage - 1);
    if (event.key === 'ArrowRight') next = Math.min(pageCount, itemPage + 1);
    if (event.key === 'Home') next = 1;
    if (event.key === 'End') next = pageCount;
    if (next === undefined) return;
    event.preventDefault();
    choosePage(next, true);
  };
  const range = items[page - 1]?.range ?? '';

  return (
    <nav aria-label={text.coursePages} aria-describedby={hintId} className={styles.ruler}>
      <span id={hintId} className="sr-only">
        {text.coursePagesHint}
      </span>
      <span className={styles.pointer} aria-hidden="true" />
      <div ref={trackRef} className={styles.track} data-course-page-track>
        {items.map((item) => (
          <button
            key={item.page}
            type="button"
            data-course-page={item.page}
            aria-current={item.page === page ? 'page' : undefined}
            aria-label={`${text.page} ${item.page} · ${text.courses} ${item.range}`}
            aria-controls="public-tutor-course-list"
            tabIndex={item.page === page ? 0 : -1}
            onClick={() => choosePage(item.page)}
            onKeyDown={(event) => handleKeyDown(event, item.page)}
            className={styles.item}
          >
            {text.page} {item.page} <span>· {item.range}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-atomic="true">
        {text.coursePageStatus
          .replace('{page}', String(page))
          .replace('{pages}', String(pageCount))
          .replace('{range}', range)
          .replace('{total}', String(total))}
      </p>
    </nav>
  );
}

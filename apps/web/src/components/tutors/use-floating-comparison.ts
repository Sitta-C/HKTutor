'use client';

import { useCallback, useEffect, useRef } from 'react';

import {
  clampFloatingPoint,
  comparisonPanelPosition,
  floatingBounds,
} from '@/components/tutors/tutor-comparison-model';

import type { Point, Viewport } from '@/components/tutors/tutor-comparison-model';
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react';

export function comparisonViewport(): Viewport {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

export function placeComparisonPanel(button: HTMLElement, panel: HTMLElement): void {
  const viewport = comparisonViewport();
  panel.style.maxWidth = `${Math.max(120, viewport.width - 24)}px`;
  panel.style.maxHeight = `${Math.max(140, viewport.height - 120)}px`;
  const rect = button.getBoundingClientRect();
  const point = comparisonPanelPosition(
    rect,
    { width: panel.offsetWidth, height: panel.offsetHeight },
    viewport,
  );
  panel.style.left = `${point.x}px`;
  panel.style.top = `${point.y}px`;
  panel.style.transformOrigin = `${rect.left + rect.width / 2 - point.x}px ${rect.top + rect.height / 2 - point.y}px`;
}

interface DragState {
  pointerId: number;
  start: Point;
  origin: Point;
  last: Point;
  time: number;
  velocity: Point;
  moved: boolean;
}

interface FloatingComparisonController {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function useFloatingComparison(
  buttonRef: RefObject<HTMLButtonElement | null>,
  panelRef: RefObject<HTMLDialogElement | null>,
  onDragStart: () => void,
  onToggle: () => void,
): FloatingComparisonController {
  const point = useRef<Point>({ x: 0, y: 0 });
  const normalized = useRef<Point>({ x: 1, y: 1 });
  const drag = useRef<DragState | null>(null);
  const frame = useRef<number | null>(null);
  const settling = useRef<Animation | null>(null);
  const suppressClick = useRef(false);

  const paint = useCallback(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }
    button.style.transform = `translate3d(${point.current.x}px, ${point.current.y}px, 0)${drag.current?.moved ? ' scale(1.045)' : ''}`;
  }, [buttonRef]);

  const remember = () => {
    const { min, max } = floatingBounds(comparisonViewport());
    normalized.current = {
      x: (point.current.x - min.x) / Math.max(1, max.x - min.x),
      y: (point.current.y - min.y) / Math.max(1, max.y - min.y),
    };
  };

  useEffect(() => {
    const fit = () => {
      const button = buttonRef.current;
      if (!button) {
        return;
      }
      settling.current?.cancel();
      const viewport = comparisonViewport();
      const { min, max } = floatingBounds(viewport);
      point.current = clampFloatingPoint(
        {
          x: min.x + normalized.current.x * (max.x - min.x),
          y: min.y + normalized.current.y * (max.y - min.y),
        },
        viewport,
      );
      button.style.inset = '0 auto auto 0';
      paint();
      if (panelRef.current?.open) {
        placeComparisonPanel(button, panelRef.current);
      }
    };
    fit();
    window.addEventListener('resize', fit);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    return () => {
      window.removeEventListener('resize', fit);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
      }
      settling.current?.cancel();
    };
  }, [buttonRef, panelRef, paint]);

  const release = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) {
      return;
    }
    const previous = point.current;
    if (current.moved && !cancelled && performance.now() - current.time < 80) {
      point.current = clampFloatingPoint(
        {
          x: previous.x + Math.max(-35, Math.min(35, current.velocity.x * 38)),
          y: previous.y + Math.max(-35, Math.min(35, current.velocity.y * 38)),
        },
        comparisonViewport(),
      );
    }
    drag.current = null;
    const button = event.currentTarget;
    delete button.dataset.dragging;
    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    paint();
    if (!current.moved) {
      return;
    }
    suppressClick.current = true;
    remember();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settling.current = button.animate(
        [
          { transform: `translate3d(${previous.x}px, ${previous.y}px, 0) scale(1.045)` },
          { transform: `translate3d(${point.current.x}px, ${point.current.y}px, 0) scale(1)` },
        ],
        { duration: 260, easing: 'cubic-bezier(.16, 1, .3, 1)' },
      );
    }
  };

  return {
    onPointerDown: (event) => {
      if (event.button !== 0 || drag.current) {
        return;
      }
      suppressClick.current = false;
      const button = event.currentTarget;
      if (settling.current) {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(button).transform);
        point.current = { x: matrix.m41, y: matrix.m42 };
        settling.current.cancel();
        settling.current = null;
        paint();
      }
      drag.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin: point.current,
        last: { x: event.clientX, y: event.clientY },
        time: performance.now(),
        velocity: { x: 0, y: 0 },
        moved: false,
      };
      button.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - current.start.x;
      const dy = event.clientY - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) < 7) {
        return;
      }
      if (!current.moved) {
        current.moved = true;
        event.currentTarget.dataset.dragging = 'true';
        onDragStart();
      }
      const now = performance.now();
      const elapsed = Math.max(8, now - current.time);
      current.velocity = {
        x: (event.clientX - current.last.x) / elapsed,
        y: (event.clientY - current.last.y) / elapsed,
      };
      current.last = { x: event.clientX, y: event.clientY };
      current.time = now;
      point.current = clampFloatingPoint(
        { x: current.origin.x + dx, y: current.origin.y + dy },
        comparisonViewport(),
      );
      if (frame.current === null) {
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          paint();
        });
      }
    },
    onPointerUp: (event) => release(event),
    onPointerCancel: (event) => release(event, true),
    onLostPointerCapture: (event) => release(event, true),
    onKeyDown: (event) => {
      const offsets: Record<string, Point> = {
        ArrowLeft: { x: -24, y: 0 },
        ArrowRight: { x: 24, y: 0 },
        ArrowUp: { x: 0, y: -24 },
        ArrowDown: { x: 0, y: 24 },
      };
      const delta = offsets[event.key];
      if (!delta) {
        return;
      }
      event.preventDefault();
      settling.current?.cancel();
      point.current = clampFloatingPoint(
        { x: point.current.x + delta.x, y: point.current.y + delta.y },
        comparisonViewport(),
      );
      paint();
      remember();
      if (panelRef.current?.open) {
        placeComparisonPanel(event.currentTarget, panelRef.current);
      }
    },
    onClick: (event) => {
      if (event.detail !== 0 && suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onToggle();
    },
  };
}

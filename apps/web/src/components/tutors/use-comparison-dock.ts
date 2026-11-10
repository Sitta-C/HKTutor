'use client';

import { useLayoutEffect } from 'react';

import {
  comparisonDockPosition,
  comparisonPanelPosition,
} from '@/components/tutors/tutor-comparison-model';

import type { Viewport } from '@/components/tutors/tutor-comparison-model';
import type { RefObject } from 'react';

function comparisonViewport(): Viewport {
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
  const rect = button.getBoundingClientRect();
  panel.style.maxWidth = `${Math.max(120, viewport.width - 24)}px`;
  // Keep all table rows together. Only the outer dialog can scroll on unusually short viewports.
  panel.style.maxHeight = `${Math.max(140, rect.top - viewport.top - 24)}px`;
  const point = comparisonPanelPosition(
    rect,
    { width: panel.offsetWidth, height: panel.offsetHeight },
    viewport,
  );
  panel.style.left = `${point.x}px`;
  panel.style.top = `${point.y}px`;
  panel.style.transformOrigin = `${rect.left + rect.width / 2 - point.x}px ${rect.top + rect.height / 2 - point.y}px`;
}

export function useComparisonDock(
  buttonRef: RefObject<HTMLButtonElement | null>,
  panelRef: RefObject<HTMLDialogElement | null>,
): void {
  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }
    const fit = () => {
      const viewport = comparisonViewport();
      button.style.width = `${Math.max(0, Math.min(352, viewport.width - 24))}px`;
      const safeBottom = Number.parseFloat(getComputedStyle(button).marginBottom) || 0;
      const point = comparisonDockPosition(
        { width: button.offsetWidth, height: button.offsetHeight },
        viewport,
        safeBottom,
      );
      button.style.inset = `${point.y}px auto auto ${point.x}px`;
      button.style.transform = 'none';
      if (panelRef.current?.open) {
        placeComparisonPanel(button, panelRef.current);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(button);
    const viewport = window.visualViewport;
    window.addEventListener('resize', fit);
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
    };
  }, [buttonRef, panelRef]);
}

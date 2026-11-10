'use client';

import { useCallback, useRef, useState } from 'react';

import { toggleComparisonChoice } from '@/components/tutors/tutor-comparison-model';

import type { ComparisonChoice } from '@/components/tutors/tutor-comparison-model';
import type { TutorComparisonSelection, TutorSearchResult } from '@/lib/api/types';

export interface ComparisonFlight {
  id: number;
  tutorId: string;
  name: string;
  source: { left: number; top: number; width: number; height: number };
}

export interface TutorComparisonController {
  choices: ComparisonChoice[];
  flights: ComparisonFlight[];
  notice: { action: 'chosen' | 'removed' | 'cleared'; name: string } | undefined;
  toggle: (result: TutorSearchResult, source: HTMLElement) => void;
  remove: (tutorId: string) => void;
  clear: () => void;
  finishFlight: (id: number) => void;
}

export function useTutorComparison(
  initialChoices: TutorComparisonSelection[] = [],
): TutorComparisonController {
  const [choices, setChoices] = useState<ComparisonChoice[]>(() =>
    initialChoices.map((choice) => ({ ...choice, displayName: '' })),
  );
  const [flights, setFlights] = useState<ComparisonFlight[]>([]);
  const [notice, setNotice] = useState<{
    action: 'chosen' | 'removed' | 'cleared';
    name: string;
  }>();
  const current = useRef(choices);
  const sequence = useRef(0);

  const remove = useCallback((tutorId: string) => {
    const choice = current.current.find((item) => item.tutorId === tutorId);
    current.current = current.current.filter((item) => item.tutorId !== tutorId);
    setChoices(current.current);
    setFlights((items) => items.filter((item) => item.tutorId !== tutorId));
    setNotice({ action: 'removed', name: choice?.displayName ?? '' });
  }, []);

  const toggle = useCallback((result: TutorSearchResult, source: HTMLElement) => {
    const next = toggleComparisonChoice(current.current, {
      tutorId: result.tutorId,
      listingId: result.listingId,
      displayName: result.displayName,
    });
    if (next === current.current) {
      return;
    }
    const added = next.some((choice) => choice.listingId === result.listingId);
    current.current = next;
    setChoices(next);
    setNotice({ action: added ? 'chosen' : 'removed', name: result.displayName });
    const rect = source.getBoundingClientRect();
    const flight: ComparisonFlight = {
      id: ++sequence.current,
      tutorId: result.tutorId,
      name: result.displayName,
      source: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
    const animate = added && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setFlights((items) => [
      ...items.filter((item) => item.tutorId !== result.tutorId),
      ...(animate ? [flight] : []),
    ]);
  }, []);

  const clear = useCallback(() => {
    current.current = [];
    setChoices([]);
    setFlights([]);
    setNotice({ action: 'cleared', name: '' });
  }, []);

  const finishFlight = useCallback((id: number) => {
    setFlights((items) => items.filter((item) => item.id !== id));
  }, []);

  return { choices, flights, notice, toggle, remove, clear, finishFlight };
}

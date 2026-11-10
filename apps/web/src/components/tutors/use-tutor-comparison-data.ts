'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { createComparisonDataStore } from '@/components/tutors/tutor-comparison-data';

import type { ComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import type { TutorComparisonSelection } from '@/lib/api/types';

export function useTutorComparisonData(
  choices: TutorComparisonSelection[],
  dialog: { open: boolean; cycle: number; now: number },
): { columns: ComparisonColumn[]; retry: (choice: TutorComparisonSelection) => void } {
  const [store] = useState(createComparisonDataStore);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { open, cycle, now } = dialog;
  useEffect(() => {
    store.reconcile(open, cycle, now, choices);
  }, [store, open, cycle, now, choices]);
  useEffect(() => () => store.clear(), [store]);
  return {
    columns: choices.map((choice) => {
      const existing =
        snapshot.cycle === cycle
          ? snapshot.columns.find(
              (column) =>
                column.choice.tutorId === choice.tutorId &&
                column.choice.listingId === choice.listingId,
            )
          : undefined;
      return existing ?? { choice, state: 'loading' };
    }),
    retry: store.retry,
  };
}

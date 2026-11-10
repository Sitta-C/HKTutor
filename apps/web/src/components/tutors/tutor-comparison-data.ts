import { buildComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import { ApiError } from '@/lib/api/error';
import { getPublicTutor, getPublicTutorAvailability } from '@/lib/api/tutors';

import type { ComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import type { TutorComparisonSelection } from '@/lib/api/types';

export async function loadComparisonColumn(
  choice: TutorComparisonSelection,
  signal: AbortSignal,
  now: number,
): Promise<ComparisonColumn> {
  try {
    const detail = await getPublicTutor(choice.tutorId, { signal });
    signal.throwIfAborted();
    const checked = buildComparisonColumn(choice, detail, [], now);
    if (checked.state !== 'ready') {
      return checked;
    }
    const slots = await getPublicTutorAvailability(
      choice.tutorId,
      { from: new Date(now).toISOString() },
      { signal },
    );
    return buildComparisonColumn(choice, detail, slots, now);
  } catch (error: unknown) {
    const unavailable = error instanceof ApiError && [400, 403, 404].includes(error.status);
    return { choice, state: unavailable ? 'unavailable' : 'error' };
  }
}

type ComparisonSnapshot = { cycle: number; columns: ComparisonColumn[] };
interface ComparisonDataStore {
  getSnapshot: () => ComparisonSnapshot;
  subscribe: (listener: () => void) => () => void;
  reconcile: (
    open: boolean,
    cycle: number,
    now: number,
    choices: TutorComparisonSelection[],
  ) => void;
  retry: (choice: TutorComparisonSelection) => void;
  clear: () => void;
}

type ColumnRequest = { abort: AbortController; timeout: ReturnType<typeof setTimeout> };

const choiceKey = (choice: TutorComparisonSelection): string =>
  JSON.stringify([choice.tutorId, choice.listingId]);

/** One popup's public reads. Each column owns its timeout, retry and cancellation identity. */
export function createComparisonDataStore(): ComparisonDataStore {
  let snapshot: ComparisonSnapshot = { cycle: -1, columns: [] };
  let referenceTime = 0;
  const listeners = new Set<() => void>();
  const requests = new Map<string, ColumnRequest>();
  const publish = (columns: ComparisonColumn[]): void => {
    snapshot = { ...snapshot, columns };
    listeners.forEach((listener) => listener());
  };
  const cancel = (key: string, request: ColumnRequest): void => {
    requests.delete(key);
    clearTimeout(request.timeout);
    request.abort.abort();
  };
  const clear = (): void => {
    requests.forEach((request, key) => cancel(key, request));
    snapshot = { cycle: -1, columns: [] };
    listeners.forEach((listener) => listener());
  };
  const start = (choice: TutorComparisonSelection): void => {
    const key = choiceKey(choice);
    const abort = new AbortController();
    const finish = (column: ComparisonColumn): void => {
      // A removed/replaced read cannot overwrite a later request for the same course.
      if (requests.get(key) !== request) {
        return;
      }
      requests.delete(key);
      clearTimeout(request.timeout);
      publish(
        snapshot.columns.map((current) => (choiceKey(current.choice) === key ? column : current)),
      );
    };
    const request: ColumnRequest = {
      abort,
      timeout: setTimeout(() => {
        finish({ choice, state: 'error' });
        abort.abort();
      }, 15_000),
    };
    requests.set(key, request);
    void loadComparisonColumn(choice, abort.signal, referenceTime).then(finish);
  };

  return {
    getSnapshot: (): ComparisonSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reconcile(
      open: boolean,
      cycle: number,
      now: number,
      choices: TutorComparisonSelection[],
    ): void {
      if (!open) {
        clear();
        return;
      }
      if (snapshot.cycle !== cycle) {
        clear();
        snapshot = { cycle, columns: [] };
        referenceTime = now;
      }
      const wanted = new Set(choices.map(choiceKey));
      requests.forEach((request, key) => {
        if (!wanted.has(key)) {
          cancel(key, request);
        }
      });
      const previous = snapshot.columns;
      const columns = choices.map((choice): ComparisonColumn => {
        const existing = previous.find((column) => choiceKey(column.choice) === choiceKey(choice));
        if (existing) {
          return existing;
        }
        start(choice);
        return { choice, state: 'loading' };
      });
      publish(columns);
    },
    retry(choice: TutorComparisonSelection): void {
      const key = choiceKey(choice);
      if (
        !snapshot.columns.some(
          (column) => choiceKey(column.choice) === key && column.state === 'error',
        )
      ) {
        return;
      }
      publish(
        snapshot.columns.map((column) =>
          choiceKey(column.choice) === key ? { choice, state: 'loading' } : column,
        ),
      );
      start(choice);
    },
    clear,
  };
}

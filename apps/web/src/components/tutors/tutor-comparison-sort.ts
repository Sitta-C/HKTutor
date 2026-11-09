import type {
  TutorComparisonEntry,
  TutorComparisonViewColumn,
} from '@/components/tutors/tutor-comparison-view-model';

export const DEFAULT_COMPARISON_SORT = 'lowest_price';
export type ComparisonSort = 'lowest_price' | 'highest_rating' | 'earliest_availability';

export interface ComparisonSortValidation {
  sort: ComparisonSort;
  error: 'invalid_sort' | null;
}

export function validateComparisonSort(value: unknown): ComparisonSortValidation {
  if (value === undefined || value === null) {
    return { sort: DEFAULT_COMPARISON_SORT, error: null };
  }
  if (value === 'lowest_price' || value === 'highest_rating' || value === 'earliest_availability') {
    return { sort: value, error: null };
  }
  return { sort: DEFAULT_COMPARISON_SORT, error: 'invalid_sort' };
}

interface SortableComparisonColumn {
  tutorId: string;
  position?: number;
  state: TutorComparisonViewColumn['state'];
  entry?: TutorComparisonEntry;
}

/** Sort whole columns, leaving the original selection untouched. Capture `now` once per refresh. */
export function sortTutorComparisonView<Column extends SortableComparisonColumn>(
  columns: readonly Column[],
  value: unknown,
  now: number,
): ComparisonSortValidation & { columns: Column[] } {
  const validation = validateComparisonSort(value);
  const ranked = columns.map((column) => ({
    column,
    value: comparisonValue(column, validation.sort, now),
  }));
  ranked.sort((left, right) => {
    if (left.value !== right.value) {
      if (left.value === null) {
        return 1;
      }
      if (right.value === null) {
        return -1;
      }
      return validation.sort === 'highest_rating'
        ? right.value - left.value
        : left.value - right.value;
    }
    const leftPosition = left.column.position ?? Number.POSITIVE_INFINITY;
    const rightPosition = right.column.position ?? Number.POSITIVE_INFINITY;
    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }
    // IDs provide a deterministic fallback when an original selection index is unavailable.
    return left.column.tutorId < right.column.tutorId
      ? -1
      : left.column.tutorId > right.column.tutorId
        ? 1
        : 0;
  });
  return { ...validation, columns: ranked.map(({ column }) => column) };
}

function comparisonValue(
  column: SortableComparisonColumn,
  sort: ComparisonSort,
  now: number,
): number | null {
  if (column.state !== 'ready' || !column.entry) {
    return null;
  }
  const values = column.entry.sort;
  switch (sort) {
    case 'lowest_price': {
      // The public API uses numeric baht; compare integer satang rather than formatted text.
      const satang = values.price === null ? Number.NaN : Math.round(values.price * 100);
      return Number.isSafeInteger(satang) && satang > 0 ? satang : null;
    }
    case 'highest_rating':
      return values.rating !== null &&
        Number.isFinite(values.rating) &&
        values.rating >= 1 &&
        values.rating <= 5
        ? values.rating
        : null;
    case 'earliest_availability':
      return values.availability !== null &&
        Number.isFinite(values.availability) &&
        values.availability > now
        ? values.availability
        : null;
  }
}

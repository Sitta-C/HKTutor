import { describe, expect, it } from 'vitest';

import {
  sortTutorComparisonView,
  validateComparisonSort,
} from '@/components/tutors/tutor-comparison-sort';

import type { TutorComparisonViewColumn } from '@/components/tutors/tutor-comparison-view-model';

const now = Date.parse('2026-11-09T00:00:00.000Z');
const future = now + 60_000;

function ready(
  tutorId: string,
  position: number,
  price: number | null = 450,
  rating: number | null = 4.33,
  availability: number | null = future,
): TutorComparisonViewColumn {
  return {
    tutorId,
    listingId: `course-${tutorId}`,
    position,
    state: 'ready',
    entry: {
      tutorId,
      listingId: `course-${tutorId}`,
      displayName: `Teacher ${tutorId}`,
      subject: `Subject ${tutorId}`,
      grade: 'Grade 10',
      pricePerHour: price,
      rating: {
        state: rating === null ? 'new' : 'rated',
        score: rating?.toFixed(2) ?? null,
        reviewCount: rating === null ? 0 : 2,
      },
      experienceYears: position,
      nextAvailability:
        availability === null
          ? null
          : {
              startAtUtc: new Date(availability).toISOString(),
              endAtUtc: new Date(availability + 3_600_000).toISOString(),
            },
      sort: { price, rating, availability },
    },
  };
}

const ids = (columns: readonly { tutorId: string }[]) => columns.map((column) => column.tutorId);

describe('comparison sort validation (S3-T33)', () => {
  it.each(['lowest_price', 'highest_rating', 'earliest_availability'])(
    'accepts only the documented sort %s',
    (sort) => expect(validateComparisonSort(sort)).toEqual({ sort, error: null }),
  );

  it.each([undefined, null])('defaults an absent value %s to lowest price', (value) => {
    expect(validateComparisonSort(value)).toEqual({ sort: 'lowest_price', error: null });
  });

  it.each(['', 'price', 'LOWEST_PRICE', '__proto__', 'toString', 1, {}, ['lowest_price']])(
    'rejects arbitrary URL/value %j and sorts by lowest price',
    (value) => {
      const columns = [ready('a', 0), ready('b', 1, 350)];
      const result = sortTutorComparisonView(columns, value, now);
      expect(result).toMatchObject({ sort: 'lowest_price', error: 'invalid_sort' });
      expect(ids(result.columns)).toEqual(['b', 'a']);
      expect(ids(columns)).toEqual(['a', 'b']);
    },
  );
});

describe('stable whole-column comparison sorting (S3-T33)', () => {
  it('puts 350 before 450 and missing price last', () => {
    const result = sortTutorComparisonView(
      [ready('a', 0), ready('b', 1, null), ready('c', 2, 350)],
      'lowest_price',
      now,
    );
    expect(ids(result.columns)).toEqual(['c', 'a', 'b']);
  });

  it('compares integer satang and uses selection order for equal satang', () => {
    const result = sortTutorComparisonView(
      [ready('a', 0, 350.29), ready('b', 1, 350.28), ready('c', 2, 350.281)],
      'lowest_price',
      now,
    );
    expect(ids(result.columns)).toEqual(['b', 'c', 'a']);
  });

  it('sorts canonical ratings descending without rounding them to display ties', () => {
    const result = sortTutorComparisonView(
      [ready('a', 0, 450, 4.664), ready('b', 1, 350, null), ready('c', 2, 500, 4.665)],
      'highest_rating',
      now,
    );
    expect(ids(result.columns)).toEqual(['c', 'a', 'b']);
  });

  it('puts earlier future instants first and missing availability last', () => {
    const result = sortTutorComparisonView(
      [ready('a', 0, 350, 5, future + 1), ready('b', 1, 450, 4, null), ready('c', 2)],
      'earliest_availability',
      now,
    );
    expect(ids(result.columns)).toEqual(['c', 'a', 'b']);
  });

  it.each([now - 1, now])(
    'treats a slot starting at %s as unavailable at captured now',
    (start) => {
      const result = sortTutorComparisonView(
        [ready('a', 0, 450, 4, start), ready('b', 1)],
        'earliest_availability',
        now,
      );
      expect(ids(result.columns)).toEqual(['b', 'a']);
    },
  );

  it.each(['lowest_price', 'highest_rating', 'earliest_availability'])(
    'uses the original selection index for %s ties even after a previous sort',
    (sort) => {
      const original = [ready('z', 0), ready('a', 1), ready('b', 2)];
      const shuffled = [original[2], original[0], original[1]].filter(
        (column) => column !== undefined,
      );
      expect(ids(sortTutorComparisonView(shuffled, sort, now).columns)).toEqual(['z', 'a', 'b']);
    },
  );

  it('falls back to tutor ID when selection positions are absent', () => {
    const columns = [ready('z', 0), ready('a', 1)].map(({ position, ...column }) => {
      expect(position).toBeDefined();
      return column;
    });
    expect(ids(sortTutorComparisonView(columns, 'lowest_price', now).columns)).toEqual(['a', 'z']);
  });

  it('keeps indexed ties ahead of unindexed ties with a consistent total order', () => {
    const unindexed = { tutorId: 'm', listingId: 'course-m', state: 'loading' as const };
    const first = { tutorId: 'z', listingId: 'course-z', state: 'loading' as const, position: 0 };
    const second = { tutorId: 'a', listingId: 'course-a', state: 'loading' as const, position: 1 };
    for (const columns of [
      [unindexed, first, second],
      [second, first, unindexed],
      [first, unindexed, second],
    ]) {
      expect(ids(sortTutorComparisonView(columns, 'lowest_price', now).columns)).toEqual([
        'z',
        'a',
        'm',
      ]);
    }
  });

  it.each(['loading', 'error', 'unavailable'] as const)('puts %s columns last', (state) => {
    const columns: TutorComparisonViewColumn[] = [
      { tutorId: 'missing', listingId: 'missing-course', position: 0, state },
      ready('a', 1),
    ];
    expect(ids(sortTutorComparisonView(columns, 'lowest_price', now).columns)).toEqual([
      'a',
      'missing',
    ]);
  });

  it.each(['lowest_price', 'highest_rating', 'earliest_availability'])(
    'preserves an immutable input and each complete column for %s',
    (sort) => {
      const first = ready('z', 0, 450, 4, future + 1);
      const second = ready('a', 1, 350, 5, future);
      const columns = Object.freeze([Object.freeze(first), Object.freeze(second)]);
      const snapshot = JSON.stringify(columns);
      const result = sortTutorComparisonView(columns, sort, now);
      expect(result.columns).not.toBe(columns);
      expect(result.columns[0]).toBe(second);
      expect(result.columns[1]).toBe(first);
      expect(JSON.stringify(columns)).toBe(snapshot);
    },
  );

  it('reconciles updated public data through the same sort without changing selection indices', () => {
    const columns = [ready('a', 0, 350), ready('b', 1, 450)];
    const before = sortTutorComparisonView(columns, 'lowest_price', now);
    const refreshed = [ready('a', 0, 500), columns[1]].filter((column) => column !== undefined);
    const after = sortTutorComparisonView(refreshed, before.sort, now);
    expect(ids(before.columns)).toEqual(['a', 'b']);
    expect(ids(after.columns)).toEqual(['b', 'a']);
    expect(after.columns.map((column) => column.position)).toEqual([1, 0]);
  });

  it('rechecks availability against the next captured refresh time', () => {
    const columns = [ready('a', 0, 450, 4, future + 1), ready('b', 1)];
    expect(ids(sortTutorComparisonView(columns, 'earliest_availability', now).columns)).toEqual([
      'b',
      'a',
    ]);
    expect(ids(sortTutorComparisonView(columns, 'earliest_availability', future).columns)).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns a fresh empty array for an empty selection', () => {
    const columns: TutorComparisonViewColumn[] = [];
    expect(sortTutorComparisonView(columns, undefined, now).columns).toEqual([]);
    expect(sortTutorComparisonView(columns, undefined, now).columns).not.toBe(columns);
  });
});

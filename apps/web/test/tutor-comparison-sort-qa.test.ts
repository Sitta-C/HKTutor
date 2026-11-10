import { describe, expect, it } from 'vitest';

import { buildComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import { sortTutorComparisonView } from '@/components/tutors/tutor-comparison-sort';
import { buildTutorComparisonView } from '@/components/tutors/tutor-comparison-view-model';

import type { ComparisonSort } from '@/components/tutors/tutor-comparison-sort';
import type { TutorComparisonViewColumn } from '@/components/tutors/tutor-comparison-view-model';
import type { PublicTutorDetail } from '@/lib/api/types';

/**
 * S3-T35: comparison sorting from API-shaped data through the real pipeline
 * (buildComparisonColumn -> buildTutorComparisonView -> sortTutorComparisonView), so every
 * assertion covers the whole column a student sees, not hand-built sort keys.
 */

const NOW = Date.parse('2026-11-10T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(ms).toISOString();

interface Tutor {
  id: string;
  name: string;
  price: number;
  rating: number | null;
  reviews: number;
  experience: number;
  subject: string;
  /** Slot start times exactly as the public API returns them, offsets included. */
  slots: string[];
}

const tutor = (id: string, values: Partial<Tutor>): Tutor => ({
  id,
  name: `Teacher ${id}`,
  price: 400,
  rating: 4,
  reviews: 3,
  experience: 2,
  subject: 'Mathematics',
  slots: [],
  ...values,
});

// The card's fixture: A 450 / 4.8 / tomorrow, B 350 / 4.4 / next week, C no rating and no slot.
const A = tutor('A', {
  price: 450,
  rating: 4.8,
  reviews: 5,
  experience: 6,
  subject: 'Physics',
  slots: [at(NOW + DAY)],
});
const B = tutor('B', {
  price: 350,
  rating: 4.4,
  reviews: 7,
  experience: 3,
  slots: [at(NOW + 7 * DAY)],
});
const C = tutor('C', { price: 500, rating: null, reviews: 0, experience: 1, subject: 'English' });

function view(tutors: readonly Tutor[], now = NOW): TutorComparisonViewColumn[] {
  return buildTutorComparisonView(
    tutors.map((item) => {
      const detail: PublicTutorDetail = {
        tutor: {
          tutorId: item.id,
          displayName: item.name,
          bio: 'Not shown in the comparison.',
          experienceYears: item.experience,
          verificationStatus: 'VERIFIED',
          ratingAverage: item.rating,
          reviewCount: item.reviews,
        },
        listings: [
          {
            listingId: `course-${item.id}`,
            subject: item.subject,
            grade: 'Grade 10',
            pricePerHour: item.price,
            description: 'Not shown in the comparison.',
          },
        ],
      };
      const slots = item.slots.map((startAtUtc, index) => ({
        id: `${item.id}-${index}`,
        startAtUtc,
        endAtUtc: at(Date.parse(startAtUtc) + 60 * 60 * 1000),
      }));
      return buildComparisonColumn(
        { tutorId: item.id, listingId: `course-${item.id}` },
        detail,
        slots,
        now,
      );
    }),
  );
}

/** Everything the student sees in one column, so a mixed-up row would fail. */
function shown(column: TutorComparisonViewColumn) {
  if (column.state !== 'ready') {
    return { tutorId: column.tutorId, state: column.state };
  }
  const { entry } = column;
  return {
    tutorId: column.tutorId,
    name: entry.displayName,
    price: entry.pricePerHour,
    subject: entry.subject,
    rating: entry.rating.score,
    reviews: entry.rating.reviewCount,
    experience: entry.experienceYears,
    slot: entry.nextAvailability?.startAtUtc ?? null,
  };
}

const expected = (item: Tutor) => ({
  tutorId: item.id,
  name: item.name,
  price: item.price,
  subject: item.subject,
  rating: item.rating === null ? null : item.rating.toFixed(2),
  reviews: item.reviews,
  experience: item.experience,
  // The fixtures have at most one slot, so the next slot is that slot if it is still ahead.
  slot: item.slots.find((slot) => Date.parse(slot) > NOW) ?? null,
});

const sorted = (tutors: readonly Tutor[], sort: unknown, now = NOW) =>
  sortTutorComparisonView(view(tutors, now), sort, now);
const order = (tutors: readonly Tutor[], sort: unknown, now = NOW) =>
  sorted(tutors, sort, now).columns.map(({ tutorId }) => tutorId);

describe('the card fixture through the real comparison pipeline (S3-T35)', () => {
  it.each<[ComparisonSort, Tutor[]]>([
    ['lowest_price', [B, A, C]],
    ['highest_rating', [A, B, C]],
    ['earliest_availability', [A, B, C]],
  ])('%s moves every value of each column with its tutor', (sort, wanted) => {
    for (const selection of [
      [A, B, C],
      [C, B, A],
      [B, C, A],
    ]) {
      const result = sorted(selection, sort);
      expect(result.error).toBeNull();
      expect(result.columns.map(shown)).toEqual(wanted.map(expected));
    }
  });

  it('shows C as New tutor with no slot, last for rating and availability', () => {
    const last = sorted([C, A, B], 'highest_rating').columns.at(-1);
    expect(last && shown(last)).toEqual(expected(C));
    expect(expected(C)).toMatchObject({ rating: null, reviews: 0, slot: null });
  });

  it('keeps 2-tutor selections sorted the same way', () => {
    expect(order([A, B], 'lowest_price')).toEqual(['B', 'A']);
    expect(order([B, A], 'highest_rating')).toEqual(['A', 'B']);
    expect(order([C, B], 'earliest_availability')).toEqual(['B', 'C']);
  });
});

describe('numbers, instants and missing values (S3-T35)', () => {
  it('sorts prices as numbers, never as text', () => {
    const tutors = [
      tutor('thousand', { price: 1000 }),
      tutor('ninety', { price: 90 }),
      tutor('almost', { price: 999.99 }),
    ];
    expect(order(tutors, 'lowest_price')).toEqual(['ninety', 'almost', 'thousand']);
    expect(['1000', '90', '999.99'].sort()).toEqual(['1000', '90', '999.99']);
  });

  it('treats one instant written with different UTC offsets as a tie in selection order', () => {
    const bangkok = tutor('bangkok', { slots: ['2026-11-12T10:00:00+07:00'] });
    const utc = tutor('utc', { slots: ['2026-11-12T03:00:00.000Z'] });
    const earlier = tutor('earlier', { slots: ['2026-11-12T09:59:00+07:00'] });
    expect(order([bangkok, utc, earlier], 'earliest_availability')).toEqual([
      'earlier',
      'bangkok',
      'utc',
    ]);
    expect(order([utc, bangkok, earlier], 'earliest_availability')).toEqual([
      'earlier',
      'utc',
      'bangkok',
    ]);
  });

  it('treats a slot that has started by the captured time as missing', () => {
    const startsNow = tutor('now', { slots: [at(NOW)] });
    const started = tutor('started', { slots: [at(NOW - 1)] });
    const soon = tutor('soon', { slots: [at(NOW + 60_000)] });
    expect(order([startsNow, started, soon], 'earliest_availability')).toEqual([
      'soon',
      'now',
      'started',
    ]);
    // Reopened after that slot began: it no longer counts either.
    expect(order([startsNow, soon, B], 'earliest_availability', NOW + 120_000)).toEqual([
      'B',
      'now',
      'soon',
    ]);
  });

  it('puts one missing value last and keeps selection order when every value is missing', () => {
    const unrated = [
      tutor('x', { rating: null, reviews: 0 }),
      tutor('y', { rating: null, reviews: 0 }),
      tutor('z', { rating: null, reviews: 0 }),
    ];
    expect(order(unrated, 'highest_rating')).toEqual(['x', 'y', 'z']);
    expect(order([...unrated].reverse(), 'highest_rating')).toEqual(['z', 'y', 'x']);
    const noSlots = [tutor('p', {}), tutor('q', {}), tutor('r', {})];
    expect(order(noSlots, 'earliest_availability')).toEqual(['p', 'q', 'r']);
    const lowRated = tutor('low', { rating: 1, reviews: 1 });
    expect(order([unrated[0] ?? C, lowRated], 'highest_rating')).toEqual(['low', 'x']);
  });

  it('keeps equal prices and equal ratings in selection order', () => {
    const first = tutor('first', { price: 350, rating: 4.4 });
    const second = tutor('second', { price: 350, rating: 4.4 });
    for (const sort of ['lowest_price', 'highest_rating'] as const) {
      expect(order([first, second], sort)).toEqual(['first', 'second']);
      expect(order([second, first], sort)).toEqual(['second', 'first']);
    }
  });
});

describe('invalid sorts and the selection (S3-T35)', () => {
  it.each(['unknown', 'PRICE', 'lowest-price', ' highest_rating', 'constructor', 42, true])(
    'reports %j and falls back to lowest price',
    (value) => {
      const result = sorted([A, B, C], value);
      expect(result).toMatchObject({ sort: 'lowest_price', error: 'invalid_sort' });
      expect(result.columns.map(shown)).toEqual([B, A, C].map(expected));
    },
  );

  it('never changes the selection, its positions or the columns while sorting', () => {
    const columns = Object.freeze(view([A, B, C]).map((column) => Object.freeze(column)));
    const snapshot = JSON.stringify(columns);
    for (const sort of ['highest_rating', 'earliest_availability', 'lowest_price', 'bad']) {
      const result = sortTutorComparisonView(columns, sort, NOW);
      expect(new Set(result.columns)).toEqual(new Set(columns));
    }
    expect(JSON.stringify(columns)).toBe(snapshot);
    expect(columns.map((column) => [column.tutorId, column.position])).toEqual([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ]);
  });
});

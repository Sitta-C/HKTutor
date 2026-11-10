import { describe, expect, it } from 'vitest';

import {
  MAX_COMPARISON_TUTORS,
  toggleComparisonChoice,
} from '@/components/tutors/tutor-comparison-model';
import {
  emptyTutorSearchSession,
  parseTutorSearchSession,
} from '@/components/tutors/tutor-search-session';

import type { TutorComparisonSelection } from '@/lib/api/types';

const pick = (tutor: number, listing = tutor): TutorComparisonSelection => ({
  tutorId: `tutor-${tutor}`,
  listingId: `course-${listing}`,
});
const tutorsOf = (choices: TutorComparisonSelection[]) => choices.map(({ tutorId }) => tutorId);

describe('comparison selection boundaries (S3-T32)', () => {
  it('counts 0, 1, 2 and 3 tutors, rejects a fourth and leaves earlier arrays untouched', () => {
    expect(MAX_COMPARISON_TUTORS).toBe(3);
    // Frozen arrays make any in-place mutation throw.
    const frozen = (choices: TutorComparisonSelection[]) =>
      Object.freeze(choices) as TutorComparisonSelection[];
    const steps = [frozen([])];
    for (const tutor of [1, 2, 3]) {
      steps.push(frozen(toggleComparisonChoice(steps.at(-1) ?? [], pick(tutor))));
    }
    expect(steps.map((choices) => choices.length)).toEqual([0, 1, 2, 3]);
    const full = steps[3] ?? [];
    expect(toggleComparisonChoice(full, pick(4))).toBe(full);
    expect(tutorsOf(full)).toEqual(['tutor-1', 'tutor-2', 'tutor-3']);
  });

  it('counts one tutor once across listings and swaps the course in place, even when full', () => {
    const full = [pick(1), pick(2), pick(3)];
    const swapped = toggleComparisonChoice(full, pick(2, 22));
    expect(swapped).toEqual([pick(1), pick(2, 22), pick(3)]);
    expect(full).toEqual([pick(1), pick(2), pick(3)]);
    expect(toggleComparisonChoice([pick(1)], pick(1, 11))).toEqual([pick(1, 11)]);
  });

  it('removes 3 to 2 to 1 to 0 keeping the remaining order, and re-adds at the end', () => {
    let choices = [pick(1), pick(2), pick(3)];
    choices = toggleComparisonChoice(choices, pick(2));
    expect(tutorsOf(choices)).toEqual(['tutor-1', 'tutor-3']);
    choices = toggleComparisonChoice(choices, pick(1));
    expect(tutorsOf(choices)).toEqual(['tutor-3']);
    choices = toggleComparisonChoice(choices, pick(3));
    expect(choices).toEqual([]);
    expect(tutorsOf(toggleComparisonChoice([pick(3)], pick(1)))).toEqual(['tutor-3', 'tutor-1']);
  });

  it('removes a tutor only by its selected course; another course of that tutor swaps instead', () => {
    expect(toggleComparisonChoice([pick(1), pick(2)], pick(2, 22))).toEqual([pick(1), pick(2, 22)]);
    expect(toggleComparisonChoice([pick(1), pick(2, 22)], pick(2, 22))).toEqual([pick(1)]);
  });
});

describe('restored comparison selections (S3-T32)', () => {
  const saved = (choices: unknown) => JSON.stringify({ ...emptyTutorSearchSession(), choices });

  it('restores up to three valid selections in their saved order, IDs only', () => {
    const restored = parseTutorSearchSession(
      saved([
        { ...pick(3), displayName: 'Cached name', pricePerHour: 999, ratingAverage: 5 },
        pick(1),
        pick(2),
      ]),
    );
    expect(restored?.choices).toEqual([pick(3), pick(1), pick(2)]);
  });

  it('accepts a 128-character identifier at the boundary', () => {
    const id = 'a'.repeat(128);
    expect(parseTutorSearchSession(saved([{ tutorId: id, listingId: id }]))?.choices).toEqual([
      { tutorId: id, listingId: id },
    ]);
  });

  it.each([
    ['empty', ''],
    ['spaced', ' tutor-1'],
    ['path-like', '../tutor-1'],
    ['slashed', 'tutor/1'],
    ['query-like', 'tutor-1?x=1'],
    ['too long', 'a'.repeat(129)],
    ['non-ASCII', 'ติวเตอร์'],
    ['numeric', 42],
    ['null', null],
    ['object', {}],
  ])('starts fresh for a %s tutor or listing ID', (_label, bad) => {
    expect(parseTutorSearchSession(saved([pick(1), { tutorId: bad, listingId: 'x' }]))).toBeNull();
    expect(parseTutorSearchSession(saved([pick(1), { tutorId: 'x', listingId: bad }]))).toBeNull();
  });

  it.each([
    ['a duplicate tutor', [pick(1), pick(1, 11)]],
    ['a duplicate listing', [pick(1), { tutorId: 'tutor-2', listingId: 'course-1' }]],
    ['four selections', [pick(1), pick(2), pick(3), pick(4)]],
    ['a non-array selection', { 0: pick(1) }],
    ['a non-object entry', ['tutor-1']],
  ])('starts fresh for %s', (_label, choices) => {
    expect(parseTutorSearchSession(saved(choices))).toBeNull();
  });

  it('keeps an empty selection as an empty, usable session', () => {
    expect(parseTutorSearchSession(saved([]))?.choices).toEqual([]);
  });
});

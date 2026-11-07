import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadComparisonColumn } from '@/components/tutors/tutor-comparison-data';
import {
  buildComparisonColumn,
  clampFloatingPoint,
  comparisonPanelPosition,
  floatingBounds,
  toggleComparisonChoice,
} from '@/components/tutors/tutor-comparison-model';
import { buildTutorRatingSummary } from '@/components/tutors/tutor-rating-model';
import { ApiError } from '@/lib/api/error';
import { getPublicTutor, getPublicTutorAvailability } from '@/lib/api/tutors';

import type { PublicAvailabilitySlot, PublicTutorDetail } from '@/lib/api/types';

vi.mock('@/lib/api/tutors', () => ({
  getPublicTutor: vi.fn(),
  getPublicTutorAvailability: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

const choices = [1, 2, 3].map((index) => ({
  tutorId: `tutor-${index}`,
  listingId: `course-${index}`,
}));
const choice = { tutorId: 'tutor-1', listingId: 'course-1' };
const detail: PublicTutorDetail = {
  tutor: {
    tutorId: choice.tutorId,
    displayName: 'Public teacher',
    bio: '',
    experienceYears: 5,
    verificationStatus: 'VERIFIED',
    ratingAverage: null,
    reviewCount: 0,
  },
  listings: [
    {
      listingId: choice.listingId,
      subject: 'Mathematics',
      grade: 'Grade 10',
      pricePerHour: 450,
      description: '',
    },
  ],
};
const now = Date.parse('2026-11-07T00:00:00.000Z');
const slot = (startAtUtc: string, endAtUtc: string): PublicAvailabilitySlot => ({
  id: startAtUtc,
  startAtUtc,
  endAtUtc,
});

describe('tutor comparison selection', () => {
  it('selects up to three different tutors and rejects a fourth without changing the array', () => {
    let selected: typeof choices = [];
    for (const candidate of choices) {
      selected = toggleComparisonChoice(selected, candidate);
    }
    expect(selected).toEqual(choices);
    expect(toggleComparisonChoice(selected, { tutorId: 'four', listingId: 'four' })).toBe(selected);
  });

  it('replaces a course at the same tutor position even when full, and toggles it off', () => {
    const replacement = { ...choice, listingId: 'another-course' };
    const selected = toggleComparisonChoice(choices, replacement);
    expect(selected).toEqual([replacement, ...choices.slice(1)]);
    expect(choices[0]).toEqual(choice);
    expect(toggleComparisonChoice(selected, replacement)).toEqual(choices.slice(1));
  });

  it('does not double-count repeated selection and allows adding after removal', () => {
    const first = toggleComparisonChoice([], choice);
    expect(first).toEqual([choice]);
    expect(toggleComparisonChoice(first, choice)).toEqual([]);
    expect(toggleComparisonChoice(choices.slice(1), choice)).toHaveLength(3);
  });
});

describe('public comparison data', () => {
  it('uses the exact selected offering and real null/zero review values', () => {
    const column = buildComparisonColumn(choice, detail, [], now);
    expect(column).toMatchObject({
      state: 'ready',
      listing: { pricePerHour: 450 },
      tutor: { ratingAverage: null, reviewCount: 0 },
      nextSlot: null,
    });
  });

  it('does not fall back to another published course or a different tutor', () => {
    expect(
      buildComparisonColumn({ ...choice, listingId: 'hidden-course' }, detail, [], now),
    ).toEqual({ choice: { ...choice, listingId: 'hidden-course' }, state: 'unavailable' });
    expect(buildComparisonColumn({ ...choice, tutorId: 'different' }, detail, [], now).state).toBe(
      'unavailable',
    );
  });

  it('finds the earliest future slot without depending on input order or host timezone', () => {
    const early = slot('2026-11-08T03:00:00.000Z', '2026-11-08T04:00:00.000Z');
    const column = buildComparisonColumn(
      choice,
      detail,
      [
        slot('2026-11-10T03:00:00.000Z', '2026-11-10T04:00:00.000Z'),
        slot('2026-11-06T03:00:00.000Z', '2026-11-06T04:00:00.000Z'),
        slot('invalid', 'invalid'),
        slot('2026-11-07T03:00:00.000Z', '2026-11-07T02:00:00.000Z'),
        early,
      ],
      now,
    );
    expect(column).toMatchObject({ nextSlot: early });
  });

  it('refreshes through public endpoints with one shared cancellation signal', async () => {
    vi.mocked(getPublicTutor).mockResolvedValueOnce(detail);
    vi.mocked(getPublicTutorAvailability).mockResolvedValueOnce([]);
    const signal = new AbortController().signal;
    expect(await loadComparisonColumn(choice, signal)).toMatchObject({ state: 'ready' });
    expect(getPublicTutor).toHaveBeenLastCalledWith(choice.tutorId, { signal });
    expect(getPublicTutorAvailability).toHaveBeenLastCalledWith(choice.tutorId, {}, { signal });
  });

  it('does not fetch availability or substitute a different offering for a missing course', async () => {
    vi.mocked(getPublicTutor).mockResolvedValueOnce({ ...detail, listings: [] });
    expect(await loadComparisonColumn(choice, new AbortController().signal)).toEqual({
      choice,
      state: 'unavailable',
    });
    expect(getPublicTutorAvailability).not.toHaveBeenCalled();
  });

  it.each([400, 403, 404, 500])(
    'distinguishes unavailable data from retryable HTTP %s',
    async (status) => {
      vi.mocked(getPublicTutor).mockRejectedValueOnce(new ApiError('Unavailable', status));
      vi.mocked(getPublicTutorAvailability).mockResolvedValueOnce([]);
      expect(await loadComparisonColumn(choice, new AbortController().signal)).toEqual({
        choice,
        state: status === 500 ? 'error' : 'unavailable',
      });
    },
  );
});

describe('comparison rating values (S3-T20)', () => {
  const rated = (ratingAverage: number | null, reviewCount: number): PublicTutorDetail => ({
    ...detail,
    tutor: { ...detail.tutor, ratingAverage, reviewCount },
  });
  // The comparison cell shows buildTutorRatingSummary of the column's tutor values.
  const shown = (ratingAverage: number | null, reviewCount: number) => {
    const column = buildComparisonColumn(choice, rated(ratingAverage, reviewCount), [], now);
    if (column.state !== 'ready') throw new Error('Expected a ready column');
    return {
      tutor: column.tutor,
      summary: buildTutorRatingSummary(column.tutor.ratingAverage, column.tutor.reviewCount),
    };
  };

  it.each([
    [4.33, 2, '4.33'],
    [1, 1, '1.00'],
    [5, 1, '5.00'],
    [4.67, 1, '4.67'],
  ])('keeps the API rating %s with %s reviews and shows %s', (ratingAverage, count, score) => {
    expect(shown(ratingAverage, count)).toEqual({
      tutor: expect.objectContaining({ ratingAverage, reviewCount: count }),
      summary: { state: 'rated', score, reviewCount: count },
    });
  });

  it('shows New tutor with 0 reviews instead of a 0.00 score', () => {
    expect(shown(null, 0).summary).toEqual({ state: 'new', score: null, reviewCount: 0 });
  });

  it('never calls a tutor with reviews new when the score is missing', () => {
    expect(shown(null, 2).summary).toEqual({ state: 'unavailable', score: null, reviewCount: 2 });
  });
});

describe('floating comparison geometry', () => {
  it.each([320, 768, 1440])('keeps button and popup inside a %spx viewport', (width) => {
    const viewport = { left: 0, top: 0, width, height: 900 };
    const { min, max } = floatingBounds(viewport);
    expect(clampFloatingPoint({ x: -500, y: -500 }, viewport)).toEqual(min);
    expect(clampFloatingPoint({ x: 9999, y: 9999 }, viewport)).toEqual(max);
    const panel = { width: Math.min(680, width - 24), height: 600 };
    for (const button of [min, max]) {
      const point = comparisonPanelPosition(
        { left: button.x, top: button.y, width: 60, height: 60 },
        panel,
        viewport,
      );
      expect(point.x).toBeGreaterThanOrEqual(12);
      expect(point.x + panel.width).toBeLessThanOrEqual(width - 12);
      expect(point.y).toBeGreaterThanOrEqual(12);
      expect(point.y + panel.height).toBeLessThanOrEqual(888);
    }
  });

  it('respects an offset visual viewport and a short viewport after keyboard/zoom changes', () => {
    const viewport = { left: 100, top: 200, width: 320, height: 240 };
    const point = clampFloatingPoint({ x: 2000, y: 2000 }, viewport);
    expect(point.x + 60).toBeLessThanOrEqual(404);
    expect(point.y + 60).toBeLessThanOrEqual(424);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createComparisonDataStore,
  loadComparisonColumn,
} from '@/components/tutors/tutor-comparison-data';
import {
  buildComparisonColumn,
  comparisonDockPosition,
  comparisonPanelPosition,
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
        slot('2026-11-07T00:00:00.000Z', '2026-11-07T01:00:00.000Z'),
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
    expect(await loadComparisonColumn(choice, signal, now)).toMatchObject({ state: 'ready' });
    expect(getPublicTutor).toHaveBeenLastCalledWith(choice.tutorId, { signal });
    expect(getPublicTutorAvailability).toHaveBeenLastCalledWith(
      choice.tutorId,
      { from: new Date(now).toISOString() },
      { signal },
    );
  });

  it('does not fetch availability or substitute a different offering for a missing course', async () => {
    vi.mocked(getPublicTutor).mockResolvedValueOnce({ ...detail, listings: [] });
    expect(await loadComparisonColumn(choice, new AbortController().signal, now)).toEqual({
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
      expect(await loadComparisonColumn(choice, new AbortController().signal, now)).toEqual({
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

describe('comparison dock geometry', () => {
  it.each([320, 768, 1440])('centers the dock and keeps its popup above it at %spx', (width) => {
    const viewport = { left: 0, top: 0, width, height: 900 };
    const dock = { width: Math.min(440, width - 24), height: 66 };
    const point = comparisonDockPosition(dock, viewport);
    expect(point.x + dock.width / 2).toBe(width / 2);
    expect(point.y + dock.height).toBe(884);
    const panel = { width: Math.min(680, width - 24), height: 600 };
    const panelPoint = comparisonPanelPosition(
      { left: point.x, top: point.y, ...dock },
      panel,
      viewport,
    );
    expect(panelPoint.x).toBeGreaterThanOrEqual(12);
    expect(panelPoint.x + panel.width).toBeLessThanOrEqual(width - 12);
    expect(panelPoint.y).toBeGreaterThanOrEqual(12);
    expect(panelPoint.y + panel.height).toBeLessThanOrEqual(point.y - 12);
  });

  it('respects offset visual viewports, changing dock height and the bottom safe area', () => {
    const viewport = { left: 100, top: 200, width: 320, height: 240 };
    const dock = { width: 296, height: 82 };
    const point = comparisonDockPosition(dock, viewport, 24);
    expect(point.x + dock.width / 2).toBe(260);
    expect(point.y + dock.height).toBe(400);
    expect(point.y).toBeGreaterThanOrEqual(viewport.top + 12);
  });
});

describe('independent comparison reads (S3-T30)', () => {
  let store = createComparisonDataStore();
  const second = { tutorId: 'tutor-2', listingId: 'course-2' };
  const secondDetail: PublicTutorDetail = {
    ...detail,
    tutor: { ...detail.tutor, tutorId: second.tutorId },
    listings: [
      {
        ...detail.listings[0],
        listingId: second.listingId,
        subject: 'Science',
        grade: 'Grade 10',
        pricePerHour: 600,
        description: '',
      },
    ],
  };
  const flush = () => vi.advanceTimersByTimeAsync(0);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    store = createComparisonDataStore();
    vi.mocked(getPublicTutorAvailability).mockResolvedValue([]);
  });
  afterEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  it('shows a ready column while another is pending, using the same captured UTC reference', async () => {
    const pending = deferred<PublicTutorDetail>();
    vi.mocked(getPublicTutor).mockImplementation((id) =>
      id === choice.tutorId ? pending.promise : Promise.resolve(secondDetail),
    );
    store.reconcile(true, 1, now, [choice, second]);
    await flush();
    expect(store.getSnapshot().columns.map((column) => column.state)).toEqual(['loading', 'ready']);
    vi.setSystemTime(now + 10_000);
    pending.resolve(detail);
    await flush();
    expect(store.getSnapshot().columns.map((column) => column.state)).toEqual(['ready', 'ready']);
    expect(vi.mocked(getPublicTutorAvailability).mock.calls.map((call) => call[1])).toEqual([
      { from: new Date(now).toISOString() },
      { from: new Date(now).toISOString() },
    ]);
  });

  it('retries only the failed tutor, rejects duplicate retries and keeps ready data', async () => {
    vi.mocked(getPublicTutor).mockImplementation((id) =>
      id === choice.tutorId
        ? Promise.reject(new ApiError('Failure', 500))
        : Promise.resolve(secondDetail),
    );
    store.reconcile(true, 1, now, [choice, second]);
    await flush();
    const ready = store.getSnapshot().columns[1];
    const pending = deferred<PublicTutorDetail>();
    vi.mocked(getPublicTutor).mockReturnValue(pending.promise);
    vi.setSystemTime(now + 5_000);
    store.retry(choice);
    store.retry(choice);
    store.retry(second);
    expect(getPublicTutor).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().columns[1]).toBe(ready);
    expect(store.getSnapshot().columns[0]?.state).toBe('loading');
    pending.resolve(detail);
    await flush();
    expect(store.getSnapshot().columns[0]?.state).toBe('ready');
    expect(store.getSnapshot().columns[1]).toBe(ready);
    expect(getPublicTutorAvailability).toHaveBeenLastCalledWith(
      choice.tutorId,
      { from: new Date(now).toISOString() },
      expect.anything(),
    );
  });

  it('keeps another failed column and supports independent concurrent retries', async () => {
    vi.mocked(getPublicTutor).mockRejectedValue(new ApiError('Failure', 500));
    store.reconcile(true, 1, now, [choice, second]);
    await flush();
    const failed = store.getSnapshot().columns[1];
    const firstRetry = deferred<PublicTutorDetail>();
    const secondRetry = deferred<PublicTutorDetail>();
    vi.mocked(getPublicTutor).mockImplementation((id) =>
      id === choice.tutorId ? firstRetry.promise : secondRetry.promise,
    );
    store.retry(choice);
    expect(store.getSnapshot().columns[1]).toBe(failed);
    store.retry(second);
    const signals = vi
      .mocked(getPublicTutor)
      .mock.calls.slice(-2)
      .map((call) => call[1]?.signal);
    expect(signals[0]).not.toBe(signals[1]);
    secondRetry.resolve(secondDetail);
    await flush();
    expect(store.getSnapshot().columns.map((column) => column.state)).toEqual(['loading', 'ready']);
    firstRetry.resolve(detail);
    await flush();
    expect(store.getSnapshot().columns.every((column) => column.state === 'ready')).toBe(true);
  });

  it('times out only the slow column and discards its late response after a successful retry', async () => {
    const pending = deferred<PublicTutorDetail>();
    vi.mocked(getPublicTutor).mockImplementation((id) =>
      id === choice.tutorId ? pending.promise : Promise.resolve(secondDetail),
    );
    store.reconcile(true, 1, now, [choice, second]);
    await flush();
    const slowSignal = vi.mocked(getPublicTutor).mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(slowSignal?.aborted).toBe(true);
    expect(store.getSnapshot().columns.map((column) => column.state)).toEqual(['error', 'ready']);
    vi.mocked(getPublicTutor).mockResolvedValue({
      ...detail,
      tutor: { ...detail.tutor, displayName: 'Fresh profile' },
    });
    store.retry(choice);
    await flush();
    const fresh = store.getSnapshot();
    pending.resolve(detail);
    await flush();
    expect(store.getSnapshot()).toBe(fresh);
    expect(getPublicTutorAvailability).toHaveBeenCalledTimes(2);
  });

  it.each(['close', 'remove', 'replace', 'reopen'] as const)(
    'discards late responses after %s',
    async (action) => {
      const pending = deferred<PublicTutorDetail>();
      vi.mocked(getPublicTutor)
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(secondDetail);
      store.reconcile(true, 1, now, [choice]);
      const signal = vi.mocked(getPublicTutor).mock.calls[0]?.[1]?.signal;
      const replacement = { ...choice, listingId: 'replacement' };
      if (action === 'close') {
        store.reconcile(false, 1, now, [choice]);
      } else if (action === 'remove') {
        store.reconcile(true, 1, now, []);
      } else if (action === 'replace') {
        store.reconcile(true, 1, now, [replacement]);
      } else {
        store.reconcile(true, 2, now + 1000, [second]);
      }
      await flush();
      const current = store.getSnapshot();
      expect(signal?.aborted).toBe(true);
      pending.resolve(detail);
      await flush();
      expect(store.getSnapshot()).toBe(current);
      expect(getPublicTutorAvailability).toHaveBeenCalledTimes(action === 'reopen' ? 1 : 0);
      if (action === 'reopen') {
        expect(getPublicTutorAvailability).toHaveBeenLastCalledWith(
          second.tutorId,
          { from: new Date(now + 1000).toISOString() },
          expect.anything(),
        );
      }
    },
  );

  it('never requests availability or exposes an unverified profile', async () => {
    const unverified = structuredClone(detail);
    // Deliberately violate the verified-only wire type to exercise runtime public-data guards.
    Reflect.set(unverified.tutor, 'verificationStatus', 'PENDING');
    vi.mocked(getPublicTutor).mockResolvedValue(unverified);
    expect(await loadComparisonColumn(choice, new AbortController().signal, now)).toEqual({
      choice,
      state: 'unavailable',
    });
    expect(getPublicTutorAvailability).not.toHaveBeenCalled();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

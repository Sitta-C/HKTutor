import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyBookings } from '@/lib/api/bookings';
import {
  clearStudentBookingCount,
  getStudentBookingCountSnapshot,
  loadStudentBookingCount,
  refreshStudentBookingCountAfterCreate,
} from '@/lib/student-booking-count';

import type { MyBookingsResponse } from '@/lib/api/types';

vi.mock('@/lib/api/bookings', () => ({ getMyBookings: vi.fn() }));

function deferred() {
  let resolve: (value: MyBookingsResponse) => void = () => {};
  const promise = new Promise<MyBookingsResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('student booking count global state', () => {
  beforeEach(() => {
    clearStudentBookingCount();
    vi.mocked(getMyBookings).mockReset().mockResolvedValue({ items: [], total: 137 });
  });

  it('uses the unfiltered server total, deduplicates reads, and supports explicit refresh', async () => {
    const first = loadStudentBookingCount('student-1', true);
    const second = loadStudentBookingCount('student-1', true);
    expect(first).toBe(second);
    await first;
    await loadStudentBookingCount('student-1');
    expect(getMyBookings).toHaveBeenCalledOnce();
    expect(getMyBookings).toHaveBeenCalledWith({ page: 1, pageSize: 1 });
    expect(getStudentBookingCountSnapshot().total).toBe(137);
    vi.mocked(getMyBookings).mockResolvedValue({ items: [], total: 138 });
    await loadStudentBookingCount('student-1', true);
    expect(getStudentBookingCountSnapshot().total).toBe(138);
  });

  it('keeps a known count while refreshing and shows unavailable after failure', async () => {
    await loadStudentBookingCount('student-1');
    const pending = deferred();
    vi.mocked(getMyBookings).mockReturnValueOnce(pending.promise);
    const read = loadStudentBookingCount('student-1', true);
    expect(getStudentBookingCountSnapshot()).toMatchObject({ total: 137, refreshing: true });
    pending.resolve({ items: [], total: 0 });
    await read;
    expect(getStudentBookingCountSnapshot().total).toBe(0);
    vi.mocked(getMyBookings).mockRejectedValueOnce(new Error('Unavailable'));
    await loadStudentBookingCount('student-1', true);
    expect(getStudentBookingCountSnapshot()).toMatchObject({ total: null, refreshing: false });
  });

  it('never exposes the previous account count or accepts its late response', async () => {
    const pending = deferred();
    vi.mocked(getMyBookings).mockReturnValueOnce(pending.promise);
    const previous = loadStudentBookingCount('student-1');
    await loadStudentBookingCount('student-2');
    pending.resolve({ items: [], total: 999 });
    await previous;
    expect(getStudentBookingCountSnapshot()).toMatchObject({ userId: 'student-2', total: 137 });
  });

  it('clears on logout/expiry and ignores an in-flight response from the old session', async () => {
    const pending = deferred();
    vi.mocked(getMyBookings).mockReturnValueOnce(pending.promise);
    const previous = loadStudentBookingCount('student-1');
    clearStudentBookingCount();
    pending.resolve({ items: [], total: 999 });
    await previous;
    expect(getStudentBookingCountSnapshot()).toEqual({
      userId: null,
      total: null,
      refreshing: false,
    });
  });

  it('refreshes after creation and rejects an older read that finishes afterwards', async () => {
    const pending = deferred();
    vi.mocked(getMyBookings).mockReturnValueOnce(pending.promise);
    const previous = loadStudentBookingCount('student-1');
    refreshStudentBookingCountAfterCreate();
    await loadStudentBookingCount('student-1');
    pending.resolve({ items: [], total: 136 });
    await previous;
    expect(getStudentBookingCountSnapshot().total).toBe(137);
    expect(getMyBookings).toHaveBeenCalledTimes(2);
  });
});

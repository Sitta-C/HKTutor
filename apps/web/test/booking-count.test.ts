import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyBookings, getTutorBookings } from '@/lib/api/bookings';
import { clearBookingCount, getBookingCountSnapshot, loadBookingCount } from '@/lib/booking-count';

vi.mock('@/lib/api/bookings', () => ({ getMyBookings: vi.fn(), getTutorBookings: vi.fn() }));

describe('role-specific booking navigation totals', () => {
  beforeEach(() => {
    clearBookingCount();
    vi.mocked(getMyBookings).mockReset().mockResolvedValue({ items: [], total: 5 });
    vi.mocked(getTutorBookings).mockReset().mockResolvedValue({ items: [], total: 137 });
  });

  it('reads only pending tutor requests and deduplicates simultaneous reads', async () => {
    const first = loadBookingCount('tutor-1', 'TUTOR', true);
    expect(loadBookingCount('tutor-1', 'TUTOR', true)).toBe(first);
    await first;
    expect(getTutorBookings).toHaveBeenCalledExactlyOnceWith({
      status: 'PENDING',
      page: 1,
      pageSize: 1,
    });
    expect(getMyBookings).not.toHaveBeenCalled();
    expect(getBookingCountSnapshot().total).toBe(137);
  });

  it('rejects a late response after changing role/account and after signing out', async () => {
    let resolve: (value: { items: []; total: number }) => void = () => {};
    vi.mocked(getTutorBookings).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const oldRequest = loadBookingCount('tutor-1', 'TUTOR');
    await loadBookingCount('student-1', 'STUDENT');
    resolve({ items: [], total: 999 });
    await oldRequest;
    expect(getBookingCountSnapshot()).toMatchObject({ userId: 'student-1', total: 5 });
    clearBookingCount();
    expect(getBookingCountSnapshot().total).toBeNull();
  });
});

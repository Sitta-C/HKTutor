import { describe, expect, it, vi } from 'vitest';

import { loadTutorDashboardBookings } from '@/components/dashboard/tutor-dashboard-data';
import {
  getTutorDashboardSummary,
  getTutorMonthOverview,
  groupTutorCoursesBySubject,
  isPastTutorRequest,
  paginateDashboardItems,
  shiftDashboardMonth,
} from '@/components/dashboard/tutor-dashboard-model';

import type { TeachingListing, TutorAvailabilitySlot, TutorBookingView } from '@/lib/api/types';

const now = Date.parse('2026-10-05T02:00:00Z');

function booking(
  id: string,
  status: TutorBookingView['status'],
  startAtUtc: string,
): TutorBookingView {
  return {
    id,
    status,
    student: { nickname: id },
    listing: {
      id: 'listing',
      subjectId: 'math',
      subjectName: 'Mathematics',
      gradeLevelId: 'g10',
      gradeLevelName: 'Grade 10',
      pricePerHour: '450.00',
      description: 'Mathematics lessons',
    },
    slot: {
      id: `slot-${id}`,
      startAtUtc,
      endAtUtc: new Date(Date.parse(startAtUtc) + 3_600_000).toISOString(),
    },
    subtotalAmount: '450.00',
    discountAmount: '0.00',
    netAmount: '450.00',
    currency: 'THB',
    createdAt: '2026-10-01T00:00:00Z',
  };
}

function listing(publicationStatus: TeachingListing['publicationStatus']): TeachingListing {
  return {
    id: publicationStatus,
    publicationStatus,
    subject: { id: 'math', code: 'MATH', name: 'Mathematics', active: true },
    gradeLevel: { id: 'g10', code: 'G10', name: 'Grade 10', active: true, sortOrder: 10 },
    pricePerHour: 450,
    description: 'Mathematics lessons',
    publishedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

describe('tutor dashboard presentation', () => {
  it('groups every course by subject identity without merging equal names or changing input', () => {
    const math = Array.from({ length: 7 }, (_, index) => ({
      ...listing('PUBLISHED'),
      id: `math-${index}`,
    }));
    const physics = {
      ...listing('DRAFT'),
      id: 'physics-course',
      subject: { id: 'physics', code: 'PHYSICS', name: 'Physics', active: true },
    };
    const otherMath = {
      ...listing('ARCHIVED'),
      id: 'other-math-course',
      subject: { id: 'other-math', code: 'OTHER', name: 'Mathematics', active: false },
    };
    const summary = getTutorMonthOverview([], [physics, ...math, otherMath], '2026-10');
    const before = summary.courses.map((course) => course.listing.id);
    const groups = groupTutorCoursesBySubject(summary.courses);
    expect(groups.map((group) => group.subject.id)).toEqual(['math', 'other-math', 'physics']);
    expect(groups[0]?.courses).toHaveLength(7);
    expect(groups[1]?.courses[0]?.listing.publicationStatus).toBe('ARCHIVED');
    expect(groups[2]?.courses[0]?.listing.publicationStatus).toBe('DRAFT');
    expect(summary.courses.map((course) => course.listing.id)).toEqual(before);
    expect(groupTutorCoursesBySubject([])).toEqual([]);
  });
  it('treats a request as past only after the lesson ends', () => {
    const ongoing = booking('ongoing', 'PENDING', '2026-10-05T01:30:00Z');
    const ended = booking('ended', 'PENDING', '2026-10-05T01:00:00Z');
    expect(isPastTutorRequest(ongoing, now)).toBe(false);
    expect(isPastTutorRequest(ended, now)).toBe(true);
    expect(isPastTutorRequest(ended, now - 1)).toBe(false);
  });
  it('only presents the earliest future confirmed booking as the next session', () => {
    const bookings = [
      booking('pending-first', 'PENDING', '2026-10-05T03:00:00Z'),
      booking('confirmed-later', 'CONFIRMED', '2026-10-05T10:00:00Z'),
      booking('completed', 'COMPLETED', '2026-10-05T04:00:00Z'),
      booking('confirmed-past', 'CONFIRMED', '2026-10-04T06:00:00Z'),
      booking('confirmed-next', 'CONFIRMED', '2026-10-05T06:00:00Z'),
    ];
    expect(getTutorDashboardSummary(bookings, [], [], now).nextBooking?.id).toBe('confirmed-next');
    expect(getTutorDashboardSummary(bookings.slice(0, 1), [], [], now).nextBooking).toBeUndefined();
  });

  it('keeps past pending requests visible and sorts requests and slots without changing input', () => {
    const bookings = [
      booking('future-pending', 'PENDING', '2026-10-06T06:00:00Z'),
      booking('past-pending', 'PENDING', '2026-09-30T06:00:00Z'),
    ];
    const slots: TutorAvailabilitySlot[] = [
      {
        id: 'reserved',
        state: 'RESERVED',
        startAtUtc: '2026-10-05T10:00:00Z',
        endAtUtc: '2026-10-05T11:00:00Z',
        createdAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'open',
        state: 'OPEN',
        startAtUtc: '2026-10-05T08:00:00Z',
        endAtUtc: '2026-10-05T09:00:00Z',
        createdAt: '2026-10-01T00:00:00Z',
      },
    ];
    const summary = getTutorDashboardSummary(bookings, [], slots, now);
    expect(summary.pendingBookings.map((item) => item.id)).toEqual([
      'past-pending',
      'future-pending',
    ]);
    expect(summary.todaySlots.map((item) => item.state)).toEqual(['OPEN', 'RESERVED']);
    expect(bookings[0]?.id).toBe('future-pending');
    expect(slots[0]?.id).toBe('reserved');
  });

  it('counts actual publication states instead of treating archived listings as drafts', () => {
    const summary = getTutorDashboardSummary(
      [],
      [listing('PUBLISHED'), listing('DRAFT'), listing('ARCHIVED')],
      [],
      now,
    );
    expect(summary).toMatchObject({ publishedCount: 1, draftCount: 1, archivedCount: 1 });
    expect(getTutorDashboardSummary([], [], [], now)).toMatchObject({
      pendingBookings: [],
      nextBooking: undefined,
      todaySlots: [],
      publishedCount: 0,
      draftCount: 0,
      archivedCount: 0,
    });
  });

  it('uses Bangkok month boundaries, confirmed/completed states and decimal-safe booking totals', () => {
    const first = booking('first', 'CONFIRMED', '2026-09-30T17:00:00Z');
    const second = booking('second', 'COMPLETED', '2026-10-08T06:00:00Z');
    first.netAmount = '0.10';
    second.netAmount = '0.20';
    first.listing.id = 'PUBLISHED';
    second.listing.id = 'PUBLISHED';
    const pending = booking('pending', 'PENDING', '2026-10-05T06:00:00Z');
    pending.listing.id = 'DRAFT';
    const data = [
      first,
      second,
      pending,
      booking('canceled', 'CANCELED', '2026-10-02T06:00:00Z'),
      booking('next-month', 'CONFIRMED', '2026-10-31T17:00:00Z'),
    ];
    const result = getTutorMonthOverview(data, [listing('DRAFT'), listing('PUBLISHED')], '2026-10');
    expect(result.confirmedCount).toBe(2);
    expect(result.minutes).toBe(120);
    expect(result.amounts).toEqual([{ currency: 'THB', minorUnits: 30 }]);
    expect(result.weeks.map((week) => week.minutes)).toEqual([60, 60, 0, 0, 0]);
    expect(result.courses.map((course) => course.listing.id)).toEqual(['PUBLISHED', 'DRAFT']);
    expect(result.courses[0]).toMatchObject({ confirmedCount: 2, minutes: 120, pendingCount: 0 });
    expect(result.courses[1]).toMatchObject({ confirmedCount: 0, pendingCount: 1 });
    expect(data[0]?.id).toBe('first');
  });

  it('separates currencies and handles leap months and year changes', () => {
    const thb = booking('thb', 'CONFIRMED', '2024-02-29T06:00:00Z');
    const usd = booking('usd', 'CONFIRMED', '2024-02-29T07:00:00Z');
    usd.currency = 'USD';
    usd.netAmount = '10.00';
    const result = getTutorMonthOverview([thb, usd], [], '2024-02');
    expect(result.weeks.at(-1)).toEqual({ startDay: 29, endDay: 29, minutes: 120 });
    expect(result.amounts).toEqual([
      { currency: 'THB', minorUnits: 45000 },
      { currency: 'USD', minorUnits: 1000 },
    ]);
    expect(shiftDashboardMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftDashboardMonth('2026-01', -1)).toBe('2025-12');
  });

  it('keeps five-item pages bounded after filtering and on the final page', () => {
    const items = Array.from({ length: 12 }, (_, index) => index);
    expect(paginateDashboardItems(items, 2)).toEqual({ page: 2, items: [5, 6, 7, 8, 9] });
    expect(paginateDashboardItems(items, 99)).toEqual({ page: 3, items: [10, 11] });
    expect(paginateDashboardItems(items.slice(0, 2), 3)).toEqual({ page: 1, items: [0, 1] });
    expect(paginateDashboardItems([], 3)).toEqual({ page: 1, items: [] });
  });

  it('loads beyond the first API page before calculating totals', async () => {
    const items = Array.from({ length: 102 }, (_, index) =>
      booking(String(index), 'PENDING', '2026-10-05T06:00:00Z'),
    );
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: items.slice(0, 100), total: 102 })
      .mockResolvedValueOnce({ items: items.slice(100), total: 102 });
    const result = await loadTutorDashboardBookings(fetchPage);
    expect(result).toHaveLength(102);
    expect(result.at(-1)?.id).toBe('101');
    expect(fetchPage).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100 });
  });

  it('rejects incomplete or duplicate API pages instead of presenting misleading totals', async () => {
    const first = booking('first', 'CONFIRMED', '2026-10-05T06:00:00Z');
    const incomplete = vi
      .fn()
      .mockResolvedValueOnce({ items: [first], total: 2 })
      .mockResolvedValueOnce({ items: [], total: 2 });
    await expect(loadTutorDashboardBookings(incomplete)).rejects.toThrow('Incomplete');
    const duplicate = vi
      .fn()
      .mockResolvedValueOnce({ items: [first], total: 2 })
      .mockResolvedValueOnce({ items: [first], total: 2 });
    await expect(loadTutorDashboardBookings(duplicate)).rejects.toThrow('changed');
  });
});

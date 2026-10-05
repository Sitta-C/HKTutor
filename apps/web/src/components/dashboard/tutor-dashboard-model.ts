import { getBangkokIsoDate } from '@/lib/date-time';

import type { TeachingListing, TutorAvailabilitySlot, TutorBookingView } from '@/lib/api/types';

export const TUTOR_DASHBOARD_PAGE_SIZE = 5;

export function paginateDashboardItems<T>(
  items: readonly T[],
  page: number,
): { page: number; items: T[] } {
  const pageCount = Math.max(1, Math.ceil(items.length / TUTOR_DASHBOARD_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  return {
    page: currentPage,
    items: items.slice(
      (currentPage - 1) * TUTOR_DASHBOARD_PAGE_SIZE,
      currentPage * TUTOR_DASHBOARD_PAGE_SIZE,
    ),
  };
}

export interface TutorBookingAmount {
  currency: string;
  minorUnits: number;
}

export interface TutorCourseOverview {
  listing: TeachingListing;
  confirmedCount: number;
  pendingCount: number;
  minutes: number;
  amounts: TutorBookingAmount[];
}

export interface TutorMonthOverview {
  confirmedCount: number;
  minutes: number;
  amounts: TutorBookingAmount[];
  weeks: { startDay: number; endDay: number; minutes: number }[];
  courses: TutorCourseOverview[];
}

export function groupTutorCoursesBySubject(courses: readonly TutorCourseOverview[]): {
  subject: TeachingListing['subject'];
  courses: TutorCourseOverview[];
}[] {
  const groups = new Map<
    string,
    { subject: TeachingListing['subject']; courses: TutorCourseOverview[] }
  >();
  for (const course of courses) {
    const subject = course.listing.subject;
    const group = groups.get(subject.id);
    if (group) {
      group.courses.push(course);
    } else {
      groups.set(subject.id, { subject, courses: [course] });
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.subject.name.localeCompare(right.subject.name) ||
      left.subject.id.localeCompare(right.subject.id),
  );
}

export function shiftDashboardMonth(month: string, direction: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 7);
}

export function getTutorMonthOverview(
  bookings: readonly TutorBookingView[],
  listings: readonly TeachingListing[],
  month: string,
): TutorMonthOverview {
  const selected = bookings.filter((booking) =>
    getBangkokIsoDate(booking.slot.startAtUtc).startsWith(month),
  );
  const confirmed = selected.filter(
    (booking) => booking.status === 'CONFIRMED' || booking.status === 'COMPLETED',
  );
  const duration = (booking: TutorBookingView) =>
    (Date.parse(booking.slot.endAtUtc) - Date.parse(booking.slot.startAtUtc)) / 60_000;
  const amounts = (items: readonly TutorBookingView[]): TutorBookingAmount[] => {
    const totals = new Map<string, number>();
    for (const booking of items) {
      const value = Math.round(Number(booking.netAmount) * 100);
      totals.set(booking.currency, (totals.get(booking.currency) ?? 0) + value);
    }
    return [...totals].map(([currency, minorUnits]) => ({ currency, minorUnits }));
  };
  const lastDay = new Date(`${shiftDashboardMonth(month, 1)}-01T00:00:00Z`);
  lastDay.setUTCDate(0);
  const days = lastDay.getUTCDate();
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, index) => ({
    startDay: index * 7 + 1,
    endDay: Math.min(index * 7 + 7, days),
    minutes: 0,
  }));
  for (const booking of confirmed) {
    const day = Number(getBangkokIsoDate(booking.slot.startAtUtc).slice(8));
    const week = weeks[Math.floor((day - 1) / 7)];
    if (week) {
      week.minutes += duration(booking);
    }
  }
  const courses = listings
    .map((listing) => {
      const courseConfirmed = confirmed.filter((booking) => booking.listing.id === listing.id);
      return {
        listing,
        confirmedCount: courseConfirmed.length,
        pendingCount: selected.filter(
          (booking) => booking.listing.id === listing.id && booking.status === 'PENDING',
        ).length,
        minutes: courseConfirmed.reduce((total, booking) => total + duration(booking), 0),
        amounts: amounts(courseConfirmed),
      };
    })
    .sort(
      (left, right) =>
        right.confirmedCount - left.confirmedCount ||
        right.pendingCount - left.pendingCount ||
        left.listing.id.localeCompare(right.listing.id),
    );
  return {
    confirmedCount: confirmed.length,
    minutes: confirmed.reduce((total, booking) => total + duration(booking), 0),
    amounts: amounts(confirmed),
    weeks,
    courses,
  };
}

export function isPastTutorRequest(booking: TutorBookingView, now: number): boolean {
  return new Date(booking.slot.endAtUtc).getTime() <= now;
}

interface TutorDashboardSummary {
  pendingBookings: TutorBookingView[];
  nextBooking: TutorBookingView | undefined;
  todaySlots: TutorAvailabilitySlot[];
  publishedCount: number;
  draftCount: number;
  archivedCount: number;
}

export function getTutorDashboardSummary(
  bookings: readonly TutorBookingView[],
  listings: readonly TeachingListing[],
  slots: readonly TutorAvailabilitySlot[],
  now: number,
): TutorDashboardSummary {
  const byLessonTime = (left: TutorBookingView, right: TutorBookingView) =>
    new Date(left.slot.startAtUtc).getTime() - new Date(right.slot.startAtUtc).getTime();
  const pendingBookings = bookings
    .filter((booking) => booking.status === 'PENDING')
    .sort(byLessonTime);
  const nextBooking = bookings
    .filter(
      (booking) =>
        booking.status === 'CONFIRMED' && new Date(booking.slot.startAtUtc).getTime() > now,
    )
    .sort(byLessonTime)[0];
  const todaySlots = [...slots].sort(
    (left, right) => new Date(left.startAtUtc).getTime() - new Date(right.startAtUtc).getTime(),
  );

  return {
    pendingBookings,
    nextBooking,
    todaySlots,
    publishedCount: listings.filter((listing) => listing.publicationStatus === 'PUBLISHED').length,
    draftCount: listings.filter((listing) => listing.publicationStatus === 'DRAFT').length,
    archivedCount: listings.filter((listing) => listing.publicationStatus === 'ARCHIVED').length,
  };
}

import { shiftDashboardMonth } from '@/components/dashboard/tutor-dashboard-model';
import { bangkokDateTimeToUtc } from '@/lib/api/availability';
import { getTutorBookings } from '@/lib/api/bookings';

import type { TutorBookingsQuery, TutorBookingView } from '@/lib/api/types';

export function getTutorDashboardMonthQuery(month: string): TutorBookingsQuery {
  const from = bangkokDateTimeToUtc(`${month}-01`, '00:00');
  const nextMonth = bangkokDateTimeToUtc(`${shiftDashboardMonth(month, 1)}-01`, '00:00');
  // The booking API's upper bound is inclusive; exclude the next Bangkok month.
  return { from: from.toISOString(), to: new Date(nextMonth.getTime() - 1).toISOString() };
}

export async function loadTutorDashboardBookings(
  query: TutorBookingsQuery,
  fetchPage: typeof getTutorBookings = getTutorBookings,
): Promise<TutorBookingView[]> {
  const pageSize = 100;
  const first = await fetchPage({ ...query, pageSize });
  const bookings = new Map(first.items.map((booking) => [booking.id, booking]));
  // Bound this load to the first response's page count, even while new bookings arrive.
  const pageCount = Math.ceil(first.total / pageSize);
  for (let page = 2; page <= pageCount; page += 1) {
    const result = await fetchPage({ ...query, page, pageSize });
    if (result.items.length === 0) {
      throw new Error('Incomplete tutor booking history');
    }
    for (const booking of result.items) {
      bookings.set(booking.id, booking);
    }
  }
  return [...bookings.values()];
}

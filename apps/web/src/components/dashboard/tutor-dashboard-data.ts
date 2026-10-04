import { getTutorBookings } from '@/lib/api/bookings';

import type { TutorBookingView } from '@/lib/api/types';

export async function loadTutorDashboardBookings(
  fetchPage: typeof getTutorBookings = getTutorBookings,
): Promise<TutorBookingView[]> {
  const pageSize = 100;
  const first = await fetchPage({ pageSize });
  const bookings = [...first.items];
  let total = first.total;
  for (let page = 2; bookings.length < total; page += 1) {
    const result = await fetchPage({ page, pageSize });
    if (result.items.length === 0) {
      throw new Error('Incomplete tutor booking history');
    }
    bookings.push(...result.items);
    total = result.total;
  }
  if (new Set(bookings.map((booking) => booking.id)).size !== bookings.length) {
    throw new Error('Tutor booking history changed during pagination');
  }
  return bookings;
}

import BookingsIndexPage from '@/components/bookings/bookings-index-page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Bookings',
  description: 'Review HKTutor booking requests and their current status.',
  robots: { index: false, follow: false },
};

export default function DashboardBookingsRoute() {
  return <BookingsIndexPage />;
}

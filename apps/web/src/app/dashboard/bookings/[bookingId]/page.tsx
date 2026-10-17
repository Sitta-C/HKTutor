import BookingDetailPage from '@/components/bookings/booking-detail-page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Booking details',
  description: 'Private booking and classroom details for HKTutor participants.',
  robots: { index: false, follow: false },
};

export default async function BookingDetailRoute({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;

  return <BookingDetailPage bookingId={bookingId} />;
}

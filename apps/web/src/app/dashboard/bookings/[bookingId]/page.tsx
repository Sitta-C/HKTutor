import BookingDetailPage from '@/components/bookings/booking-detail-page';
import { NotificationBookingReceipt } from '@/components/notifications/notification-booking-receipt';
import { NOTIFICATION_LINK_PARAM } from '@/lib/notification-navigation';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Booking details',
  description: 'Private booking and classroom details for HKTutor participants.',
  robots: { index: false, follow: false },
};

export default async function BookingDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const notification = query[NOTIFICATION_LINK_PARAM];
  const notificationId =
    typeof notification === 'string' && notification.length <= 128 ? notification : undefined;

  return (
    <>
      <NotificationBookingReceipt bookingId={bookingId} notificationId={notificationId} />
      <BookingDetailPage bookingId={bookingId} />
    </>
  );
}

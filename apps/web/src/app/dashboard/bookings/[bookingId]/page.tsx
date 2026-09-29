import StudentBookingDetailPage from '@/components/bookings/student-booking-detail-page';

export default async function BookingDetailRoute({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;

  return <StudentBookingDetailPage bookingId={bookingId} />;
}

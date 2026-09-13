import StudentBookingDetailPage from '@/components/bookings/student-booking-detail-page';
import StudentBookingShell from '@/components/bookings/student-booking-shell';

export default async function BookingDetailRoute({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;

  return (
    <StudentBookingShell>
      <StudentBookingDetailPage bookingId={bookingId} />
    </StudentBookingShell>
  );
}

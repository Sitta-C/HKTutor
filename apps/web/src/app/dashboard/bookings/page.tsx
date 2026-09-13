import StudentBookingShell from '@/components/bookings/student-booking-shell';
import StudentBookingsPage from '@/components/bookings/student-bookings-page';

export default function DashboardBookingsRoute() {
  return (
    <StudentBookingShell>
      <StudentBookingsPage />
    </StudentBookingShell>
  );
}

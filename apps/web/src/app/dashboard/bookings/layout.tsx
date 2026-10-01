import StudentBookingShell from '@/components/bookings/student-booking-shell';

export default function DashboardBookingsLayout({ children }: { children: React.ReactNode }) {
  return <StudentBookingShell>{children}</StudentBookingShell>;
}

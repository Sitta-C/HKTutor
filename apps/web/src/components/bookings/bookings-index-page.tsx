'use client';

import StudentBookingsPage from '@/components/bookings/student-bookings-page';
import TutorBookingInbox from '@/components/bookings/tutor-booking-inbox';
import { useAuth } from '@/lib/auth-context';

/**
 * `/dashboard/bookings` serves both roles: students review the requests they sent, tutors reply to
 * the requests they received. The surrounding shell resolves the session before this renders.
 */
export default function BookingsIndexPage() {
  const { user } = useAuth();

  if (user?.role === 'TUTOR') return <TutorBookingInbox />;
  return <StudentBookingsPage />;
}

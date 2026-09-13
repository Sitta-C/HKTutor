import { Suspense } from 'react';

import BookingConfirmationPage from '@/components/bookings/booking-confirmation-page';
import { BookingLoading } from '@/components/bookings/booking-ui';
import StudentBookingShell from '@/components/bookings/student-booking-shell';

export default function NewBookingRoute() {
  return (
    <StudentBookingShell>
      <Suspense fallback={<BookingLoading />}>
        <BookingConfirmationPage />
      </Suspense>
    </StudentBookingShell>
  );
}

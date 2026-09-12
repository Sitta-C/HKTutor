import { Suspense } from 'react';

import BookingConfirmationPage from '@/components/bookings/booking-confirmation-page';
import StudentBookingShell from '@/components/bookings/student-booking-shell';

export default function NewBookingRoute() {
  return (
    <StudentBookingShell>
      <Suspense fallback={<p className="p-6 text-sm font-semibold">Loading booking…</p>}>
        <BookingConfirmationPage />
      </Suspense>
    </StudentBookingShell>
  );
}

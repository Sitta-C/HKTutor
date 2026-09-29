import { Suspense } from 'react';

import BookingConfirmationPage from '@/components/bookings/booking-confirmation-page';
import { BookingLoading } from '@/components/bookings/booking-ui';

export default function NewBookingRoute() {
  return (
    <Suspense fallback={<BookingLoading />}>
      <BookingConfirmationPage />
    </Suspense>
  );
}

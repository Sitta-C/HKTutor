'use client';

import { useEffect, useState } from 'react';

import { bookingPaymentDeadline, hasPaymentDeadlinePassed } from '@/lib/booking-payment-deadline';

export function useBookingPaymentDeadline(startAtUtc: string): {
  deadlineAt: number;
  deadlinePassed: boolean;
} {
  const deadlineAt = bookingPaymentDeadline(startAtUtc);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function sync(): void {
      const time = Date.now();
      setNow(time);
      clearTimeout(timer);
      if (time < deadlineAt) {
        timer = setTimeout(sync, Math.min(deadlineAt - time, 2_147_483_647));
      }
    }
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [deadlineAt]);

  return { deadlineAt, deadlinePassed: hasPaymentDeadlinePassed(startAtUtc, now) };
}

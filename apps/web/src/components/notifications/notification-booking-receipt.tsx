'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { markNotificationRead } from '@/lib/api/notifications';
import { useAuth } from '@/lib/auth-context';
import { notifyNotificationsChanged } from '@/lib/notification-events';
import { consumeNotificationOpen, NOTIFICATION_LINK_PARAM } from '@/lib/notification-navigation';

/** Native new-tab actions do not run Link.onNavigate; acknowledge after the destination mounts. */
export function NotificationBookingReceipt({
  bookingId,
  notificationId,
}: {
  bookingId: string;
  notificationId: string | undefined;
}) {
  const { user } = useAuth();
  const attempted = useRef<string | null>(null);
  const userId = user?.id;
  const eligible = user?.role === 'STUDENT' || user?.role === 'TUTOR';
  const pathname = usePathname();
  const bookingPath = `/dashboard/bookings/${encodeURIComponent(bookingId)}`;

  useEffect(() => {
    if (!notificationId || pathname !== bookingPath) {
      return;
    }
    // Wait until the router has committed its history entry. Reusing the source page's history
    // state during an in-flight navigation can restore the old route instead of the booking.
    const frame = requestAnimationFrame(() => {
      const url = new URL(window.location.href);
      if (
        url.pathname === bookingPath &&
        url.searchParams.get(NOTIFICATION_LINK_PARAM) === notificationId
      ) {
        url.searchParams.delete(NOTIFICATION_LINK_PARAM);
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [bookingPath, notificationId, pathname]);

  useEffect(() => {
    if (!notificationId || !userId || !eligible) {
      return;
    }
    const intent = JSON.stringify([userId, notificationId]);
    if (attempted.current === intent) {
      return;
    }
    attempted.current = intent;

    if (consumeNotificationOpen(userId, notificationId)) {
      return;
    }

    void markNotificationRead(notificationId)
      .then(() => notifyNotificationsChanged(userId))
      .catch(() => {
        // Read receipts are best effort. Booking access and failed/unread receipts stay unchanged.
      });
  }, [eligible, notificationId, userId]);

  return null;
}

'use client';

import { useEffect, useRef } from 'react';

import { markNotificationRead } from '@/lib/api/notifications';
import { useAuth } from '@/lib/auth-context';
import { notifyNotificationsChanged } from '@/lib/notification-events';
import { consumeNotificationOpen, NOTIFICATION_LINK_PARAM } from '@/lib/notification-navigation';

/** Native new-tab actions do not run Link.onNavigate; acknowledge after the destination mounts. */
export function NotificationBookingReceipt({
  notificationId,
}: {
  notificationId: string | undefined;
}) {
  const { user } = useAuth();
  const attempted = useRef<string | null>(null);
  const userId = user?.id;
  const eligible = user?.role === 'STUDENT' || user?.role === 'TUTOR';

  useEffect(() => {
    if (!notificationId || !userId || !eligible) {
      return;
    }
    const intent = JSON.stringify([userId, notificationId]);
    if (attempted.current === intent) {
      return;
    }
    attempted.current = intent;

    const url = new URL(window.location.href);
    if (url.searchParams.get(NOTIFICATION_LINK_PARAM) === notificationId) {
      url.searchParams.delete(NOTIFICATION_LINK_PARAM);
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
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

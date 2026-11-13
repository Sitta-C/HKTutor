import { notificationCopy } from '@/components/notifications/notification-copy';
import { NOTIFICATION_LINK_PARAM } from '@/lib/notification-navigation';

import type { InboxNotification, NotificationPage } from '@/lib/api/types';

export function notificationTitle(item: InboxNotification, language: 'en' | 'th'): string {
  const events = notificationCopy[language].events;
  return Object.hasOwn(events, item.eventType)
    ? events[item.eventType as keyof typeof events]
    : item.title;
}

export function notificationDescription(item: InboxNotification, language: 'en' | 'th'): string {
  const text = notificationCopy[language];
  return Object.hasOwn(text.reminderDetails, item.eventType)
    ? text.reminderDetails[item.eventType as keyof typeof text.reminderDetails]
    : Object.hasOwn(text.eventDetails, item.eventType)
      ? text.eventDetails[item.eventType as keyof typeof text.eventDetails]
      : text.detailsHint;
}

export function notificationReminderKind(eventType: string): 'class' | 'payment' | null {
  switch (eventType) {
    case 'CLASS_REMINDER_24H':
    case 'CLASS_REMINDER_1H':
    case 'CLASS_REMINDER_5H':
      return 'class';
    case 'PAYMENT_REMINDER_24H':
    case 'PAYMENT_REMINDER_1H':
    case 'PAYMENT_REMINDER_5H':
    case 'PAYMENT_QR_READY':
      return 'payment';
    default:
      return null;
  }
}

export function notificationBookingHref(
  bookingId: string | null,
  notificationId?: string,
): string | null {
  if (!bookingId?.trim()) {
    return null;
  }
  const path = `/dashboard/bookings/${encodeURIComponent(bookingId)}`;
  const query = new URLSearchParams();
  if (notificationId) {
    query.set(NOTIFICATION_LINK_PARAM, notificationId);
  }
  return `${path}${query.size ? `?${query}` : ''}`;
}

export function mergeNotificationPage(
  current: NotificationPage,
  next: NotificationPage,
): NotificationPage {
  const items = new Map(current.items.map((item) => [item.id, item]));
  for (const item of next.items) {
    items.set(item.id, item);
  }
  return { ...next, items: [...items.values()] };
}

/** Preserve older loaded pages only when the fresh page overlaps their known history. */
export function refreshNotificationPage(
  current: NotificationPage | null,
  fresh: NotificationPage,
  unreadOnly: boolean,
): NotificationPage {
  if (!current || !fresh.items.some((item) => current.items.some(({ id }) => id === item.id))) {
    return fresh;
  }
  // A 5H or legacy 1H reminder can retire a loaded 24H row outside this first page. Re-fetch
  // older history through the server cursor rather than guessing the rescheduled occurrence.
  const urgentReplacement = fresh.items.some(
    (item) =>
      [
        'CLASS_REMINDER_1H',
        'PAYMENT_REMINDER_1H',
        'CLASS_REMINDER_5H',
        'PAYMENT_REMINDER_5H',
      ].includes(item.eventType) &&
      item.bookingId !== null &&
      (!current.items.some(({ id }) => id === item.id) ||
        fresh.unreadCount < current.unreadCount) &&
      current.items.some(
        (older) =>
          older.bookingId === item.bookingId &&
          (older.eventType === 'CLASS_REMINDER_24H' || older.eventType === 'PAYMENT_REMINDER_24H'),
      ),
  );
  if (urgentReplacement) {
    return fresh;
  }
  const merged = mergeNotificationPage(current, fresh);
  const freshIds = new Set(fresh.items.map(({ id }) => id));
  return {
    ...merged,
    nextCursor: fresh.nextCursor === null ? null : current.nextCursor,
    items: [
      ...fresh.items,
      ...(fresh.nextCursor === null ? [] : merged.items.filter(({ id }) => !freshIds.has(id))),
    ].filter((item) => !unreadOnly || item.readAt === null),
  };
}

export function optimisticNotificationRead(
  page: NotificationPage,
  notificationId: string | null,
  readAt: string,
): NotificationPage {
  let changed = 0;
  const items = page.items.map((item) => {
    if (item.readAt !== null || (notificationId !== null && item.id !== notificationId)) {
      return item;
    }
    changed += 1;
    return { ...item, readAt };
  });
  return {
    ...page,
    items,
    unreadCount: notificationId === null ? 0 : Math.max(0, page.unreadCount - changed),
  };
}

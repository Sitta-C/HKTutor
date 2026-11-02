import { notificationCopy } from '@/components/notifications/notification-copy';

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
    : text.detailsHint;
}

export function notificationReminderKind(eventType: string): 'class' | 'payment' | null {
  switch (eventType) {
    case 'CLASS_REMINDER_24H':
    case 'CLASS_REMINDER_1H':
      return 'class';
    case 'PAYMENT_REMINDER_24H':
    case 'PAYMENT_REMINDER_1H':
      return 'payment';
    default:
      return null;
  }
}

export function notificationBookingHref(bookingId: string | null): string | null {
  return bookingId?.trim() ? `/dashboard/bookings/${encodeURIComponent(bookingId)}` : null;
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

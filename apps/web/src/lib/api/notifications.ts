'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  NotificationPage,
  NotificationReadReceipt,
  NotificationsQuery,
  NotificationsReadAllResult,
} from '@/lib/api/types';

export function getNotifications(query: NotificationsQuery = {}): Promise<NotificationPage> {
  const params = new URLSearchParams();
  if (query.cursor !== undefined) {
    params.set('cursor', query.cursor);
  }
  if (query.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query.unreadOnly !== undefined) {
    params.set('unreadOnly', String(query.unreadOnly));
  }
  return authenticatedFetch<NotificationPage>(`/notifications${params.size ? `?${params}` : ''}`);
}

export function markNotificationRead(notificationId: string): Promise<NotificationReadReceipt> {
  return authenticatedFetch<NotificationReadReceipt>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'PATCH' },
  );
}

export function markAllNotificationsRead(): Promise<NotificationsReadAllResult> {
  return authenticatedFetch<NotificationsReadAllResult>('/notifications/read-all', {
    method: 'POST',
  });
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationCopy } from '@/components/notifications/notification-copy';
import {
  mergeNotificationPage,
  notificationBookingHref,
  notificationTitle,
  optimisticNotificationRead,
} from '@/components/notifications/notification-model';
import { clearAccessToken, setAccessToken } from '@/lib/api/client';
import { ApiError } from '@/lib/api/error';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications';

import type { InboxNotification, NotificationPage } from '@/lib/api/types';

const item: InboxNotification = {
  id: 'notice-one',
  eventType: 'BOOKING_CONFIRMED',
  title: 'Booking confirmed',
  bookingId: 'booking/one',
  readAt: null,
  createdAt: '2026-10-17T18:30:00.000Z',
};
const readAt = '2026-10-18T01:00:00.000Z';

describe('notification presentation and optimistic state', () => {
  const page: NotificationPage = {
    items: [item, { ...item, id: 'already-read', readAt }],
    unreadCount: 7,
    nextCursor: 'older',
  };
  it('marks only the selected item without changing the rollback snapshot or page cursor', () => {
    const optimistic = optimisticNotificationRead(page, item.id, readAt);
    expect(optimistic.unreadCount).toBe(6);
    expect(optimistic.items[0]?.readAt).toBe(readAt);
    expect(optimistic.nextCursor).toBe('older');
    expect(page.items[0]?.readAt).toBeNull();
    expect(page.unreadCount).toBe(7);
  });
  it('does not decrement twice for an already-read or missing item', () => {
    expect(optimisticNotificationRead(page, 'already-read', readAt).unreadCount).toBe(7);
    expect(optimisticNotificationRead(page, 'missing', readAt).unreadCount).toBe(7);
  });
  it('marks all unread across pages while preserving existing receipts', () => {
    const result = optimisticNotificationRead(page, null, '2026-10-19T01:00:00.000Z');
    expect(result.unreadCount).toBe(0);
    expect(result.items.every((notification) => notification.readAt !== null)).toBe(true);
    expect(result.items[1]?.readAt).toBe(readAt);
    expect(page.items[0]?.readAt).toBeNull();
  });
  it('merges cursor pages without duplicating rows and trusts the inbox-wide count', () => {
    const next: NotificationPage = {
      items: [
        { ...item, readAt },
        { ...item, id: 'older-notice' },
      ],
      unreadCount: 9,
      nextCursor: null,
    };
    const result = mergeNotificationPage(page, next);
    expect(result.items.map((notification) => notification.id)).toEqual([
      'notice-one',
      'already-read',
      'older-notice',
    ]);
    expect(result.items[0]?.readAt).toBe(readAt);
    expect(result.unreadCount).toBe(9);
    expect(result.nextCursor).toBeNull();
  });
  it.each([null, '', '   '])('does not invent a booking target for %s', (bookingId) => {
    expect(notificationBookingHref(bookingId)).toBeNull();
  });
  it('encodes the entire booking ID as a path segment', () => {
    expect(notificationBookingHref('booking/one?x=1')).toBe(
      '/dashboard/bookings/booking%2Fone%3Fx%3D1',
    );
  });
  it('translates known events and preserves titles for future event types', () => {
    expect(notificationTitle(item, 'th')).toBe('ยืนยันการจองแล้ว');
    expect(notificationTitle({ ...item, eventType: 'FUTURE_EVENT', title: 'Update' }, 'en')).toBe(
      'Update',
    );
    expect(notificationTitle({ ...item, eventType: 'toString', title: 'Update' }, 'en')).toBe(
      'Update',
    );
  });
  it('keeps both languages and all supported event keys aligned', () => {
    expect(Object.keys(notificationCopy.th)).toEqual(Object.keys(notificationCopy.en));
    expect(Object.keys(notificationCopy.th.events)).toEqual(
      Object.keys(notificationCopy.en.events),
    );
  });
});

describe('notification API client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    setAccessToken('unit-test-token');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    clearAccessToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  it('lists using the authenticated owner endpoint and opaque cursor without caller identity', async () => {
    const result: NotificationPage = { items: [item], nextCursor: null, unreadCount: 1 };
    fetchMock.mockResolvedValueOnce(response(result));
    expect(await getNotifications({ cursor: 'opaque+/=?', limit: 20, unreadOnly: false })).toEqual(
      result,
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/notifications?cursor=opaque%2B%2F%3D%3F&limit=20&unreadOnly=false');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer unit-test-token');
    expect(init?.body).toBeUndefined();
  });
  it('preserves UTC receipts and encodes the mark-one ID', async () => {
    fetchMock.mockResolvedValueOnce(response({ id: item.id, readAt }));
    expect(await markNotificationRead('notice/id')).toEqual({ id: item.id, readAt });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/notifications/notice%2Fid/read');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it('marks all through POST without sending page limits or user IDs', async () => {
    fetchMock.mockResolvedValueOnce(response({ updatedCount: 0, readAt: null }));
    expect(await markAllNotificationsRead()).toEqual({ updatedCount: 0, readAt: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/notifications/read-all');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it.each([403, 404, 409, 500])('propagates %s for rollback and recovery', async (status) => {
    fetchMock.mockResolvedValueOnce(response({ message: 'Rejected' }, status));
    await expect(markNotificationRead(item.id)).rejects.toMatchObject({ status, name: 'ApiError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not convert a failed list into an empty inbox', async () => {
    fetchMock.mockResolvedValueOnce(response({ message: 'Forbidden' }, 403));
    await expect(getNotifications()).rejects.toBeInstanceOf(ApiError);
  });
});

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  mergeNotificationPage,
  optimisticNotificationRead,
  refreshNotificationPage,
} from '@/components/notifications/notification-model';
import { ApiError } from '@/lib/api/error';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications';
import {
  notificationChannelName,
  NOTIFICATIONS_CHANGED_EVENT,
  notifyNotificationsChanged,
} from '@/lib/notification-events';

import type { NotificationPage } from '@/lib/api/types';

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
type InboxError = 'loadFailed' | 'saveFailed' | 'forbidden' | 'missing';
type InboxBusy = 'load' | 'more' | 'write' | null;

interface NotificationInboxState {
  page: NotificationPage | null;
  busy: InboxBusy;
  error: InboxError | null;
  needsRefresh: boolean;
  syncFailed: boolean;
  unreadOnly: boolean;
  changeFilter: (unreadOnly: boolean) => void;
  reload: (cursor?: string) => void;
  markRead: (notificationId: string | null) => Promise<void>;
}

export function useNotificationInbox(userId: string): NotificationInboxState {
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [busy, setBusy] = useState<InboxBusy>('load');
  const [error, setError] = useState<InboxError | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const snapshot = useRef<NotificationPage | null>(null);
  const filter = useRef(false);
  const active = useRef(false);
  const sequence = useRef(0);
  const gate = useRef<InboxBusy | 'refresh'>(null);
  const controller = useRef<AbortController | null>(null);
  const pendingRefresh = useRef(false);
  const reconcileRequired = useRef(false);

  const commitPage = useCallback((next: NotificationPage | null): void => {
    snapshot.current = next;
    setPage(next);
  }, []);

  const cancelBackgroundRead = useCallback((): void => {
    if (gate.current === 'refresh') {
      sequence.current += 1;
      controller.current?.abort();
      gate.current = null;
    }
  }, []);

  const load = useCallback(
    async function load({
      cursor,
      background = false,
      replace = false,
    }: { cursor?: string; background?: boolean; replace?: boolean } = {}): Promise<void> {
      if (!active.current || (background && document.hidden)) {
        return;
      }
      if (!background) {
        cancelBackgroundRead();
      }
      if (gate.current) {
        if (background) {
          pendingRefresh.current = true;
        }
        return;
      }
      if (background && reconcileRequired.current) {
        return;
      }
      gate.current = background ? 'refresh' : cursor ? 'more' : 'load';
      const request = ++sequence.current;
      const abort = new AbortController();
      controller.current = abort;
      try {
        const next = await getNotifications(
          { limit: 20, unreadOnly: filter.current, ...(cursor ? { cursor } : {}) },
          abort.signal,
        );
        if (!active.current || request !== sequence.current) {
          return;
        }
        const current = snapshot.current;
        commitPage(
          cursor && current
            ? mergeNotificationPage(current, next)
            : background && !replace
              ? refreshNotificationPage(current, next, filter.current)
              : next,
        );
        setError(null);
        setSyncFailed(false);
        setNeedsRefresh(false);
        reconcileRequired.current = false;
      } catch (caught: unknown) {
        if (!active.current || request !== sequence.current || abort.signal.aborted) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 403) {
          commitPage(null);
          setError('forbidden');
          setNeedsRefresh(true);
          reconcileRequired.current = true;
        } else if (background) {
          setSyncFailed(true);
        } else {
          setError('loadFailed');
        }
      } finally {
        if (active.current && request === sequence.current) {
          gate.current = null;
          controller.current = null;
          if (!background) {
            setBusy(null);
          }
          if (pendingRefresh.current) {
            pendingRefresh.current = false;
            void load({ background: true });
          }
        }
      }
    },
    [cancelBackgroundRead, commitPage],
  );

  useEffect(() => {
    active.current = true;
    void load();
    const refresh = () => void load({ background: true });
    const resume = () => {
      if (document.hidden) {
        cancelBackgroundRead();
      } else {
        void load({ background: true, replace: true });
      }
    };
    const timer = setInterval(refresh, NOTIFICATION_POLL_INTERVAL_MS);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(notificationChannelName(userId));
        channel.onmessage = (event: MessageEvent<unknown>) => {
          if (event.data === 'changed') {
            void load({ background: true, replace: true });
          }
        };
      }
    } catch {
      // Polling and focus refresh also work when the browser disables BroadcastChannel.
    }
    return () => {
      active.current = false;
      sequence.current += 1;
      controller.current?.abort();
      gate.current = null;
      clearInterval(timer);
      channel?.close();
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, [cancelBackgroundRead, load, userId]);

  function changeFilter(next: boolean): void {
    cancelBackgroundRead();
    if (gate.current || next === filter.current) {
      return;
    }
    filter.current = next;
    setUnreadOnly(next);
    commitPage(null);
    setBusy('load');
    setError(null);
    void load();
  }

  function reload(cursor?: string): void {
    cancelBackgroundRead();
    if (gate.current) {
      return;
    }
    setBusy(cursor ? 'more' : 'load');
    setError(null);
    void load(cursor === undefined ? {} : { cursor });
  }

  async function markRead(notificationId: string | null): Promise<void> {
    cancelBackgroundRead();
    const previous = snapshot.current;
    if (gate.current || !previous || reconcileRequired.current) {
      return;
    }
    if (notificationId !== null && previous.items.find(({ id }) => id === notificationId)?.readAt) {
      return;
    }
    gate.current = 'write';
    const request = ++sequence.current;
    const optimistic = optimisticNotificationRead(
      previous,
      notificationId,
      new Date().toISOString(),
    );
    commitPage(optimistic);
    setBusy('write');
    setError(null);
    try {
      const result =
        notificationId === null
          ? await markAllNotificationsRead()
          : await markNotificationRead(notificationId);
      // A navigation may unmount this inbox while the successful write still needs to notify peers.
      notifyNotificationsChanged(userId);
      if (!active.current || request !== sequence.current) {
        return;
      }
      if (result.readAt !== null) {
        const readAt = result.readAt;
        commitPage({
          ...optimistic,
          items: optimistic.items.map((item) =>
            previous.items.some((before) => before.id === item.id && before.readAt === null) &&
            (notificationId === null || item.id === notificationId)
              ? { ...item, readAt }
              : item,
          ),
        });
      }
    } catch (caught: unknown) {
      if (active.current && request === sequence.current) {
        commitPage(previous);
        setNeedsRefresh(true);
        reconcileRequired.current = true;
        setError(
          caught instanceof ApiError && caught.status === 403
            ? 'forbidden'
            : caught instanceof ApiError && caught.status === 404
              ? 'missing'
              : 'saveFailed',
        );
      }
    } finally {
      if (active.current && request === sequence.current) {
        gate.current = null;
        setBusy(null);
        if (pendingRefresh.current) {
          pendingRefresh.current = false;
          void load({ background: true });
        }
      }
    }
  }

  return {
    page,
    busy,
    error,
    needsRefresh,
    syncFailed,
    unreadOnly,
    changeFilter,
    reload,
    markRead,
  };
}

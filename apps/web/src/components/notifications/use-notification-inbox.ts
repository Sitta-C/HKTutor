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
  notifyNotificationsChanged,
  subscribeNotificationsChanged,
} from '@/lib/notification-events';
import { rememberNotificationOpen } from '@/lib/notification-navigation';

import type { NotificationPage } from '@/lib/api/types';

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
type InboxError = 'loadFailed' | 'saveFailed' | 'forbidden' | 'missing';
type InboxBusy = 'load' | 'more' | 'write' | null;

export interface NotificationInboxState {
  page: NotificationPage | null;
  busy: InboxBusy;
  error: InboxError | null;
  needsRefresh: boolean;
  syncFailed: boolean;
  unreadOnly: boolean;
  changeFilter: (unreadOnly: boolean) => void;
  reload: (cursor?: string) => void;
  refresh: () => void;
  markRead: (notificationId: string | null) => Promise<void>;
  openBooking: (notificationId: string) => void;
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
  const forbidden = useRef(false);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  const commitPage = useCallback((next: NotificationPage | null): void => {
    snapshot.current = next;
    setPage(next);
  }, []);

  const cancelRead = useCallback((includeForeground = false): void => {
    if (
      gate.current === 'refresh' ||
      (includeForeground && (gate.current === 'load' || gate.current === 'more'))
    ) {
      sequence.current += 1;
      controller.current?.abort();
      controller.current = null;
      gate.current = null;
      setBusy(null);
    }
  }, []);

  const load = useCallback(
    async function load({
      cursor,
      background = false,
    }: { cursor?: string; background?: boolean } = {}): Promise<void> {
      if (!active.current || (background && document.hidden)) {
        return;
      }
      if (!background) {
        cancelRead();
      }
      if (gate.current) {
        if (background) {
          pendingRefresh.current = true;
        }
        return;
      }
      if (background && forbidden.current) {
        return;
      }
      gate.current = background ? 'refresh' : cursor ? 'more' : 'load';
      const request = ++sequence.current;
      const abort = new AbortController();
      controller.current = abort;
      try {
        let next = await getNotifications(
          { limit: 20, unreadOnly: filter.current, ...(cursor ? { cursor } : {}) },
          abort.signal,
        );
        if (!active.current || request !== sequence.current) {
          return;
        }
        const current = snapshot.current;
        // A failed response may hide a persisted receipt on an older loaded page. Reconcile that
        // loaded window before allowing another write, without replaying the failed PATCH/POST.
        const reconcile = reconcileRequired.current;
        if (background && reconcile && current) {
          const oldestId = current.items.at(-1)?.id;
          const maxPages = Math.ceil(current.items.length / 20) + 1;
          const cursors = new Set<string>();
          while (
            next.nextCursor &&
            !next.items.some(({ id }) => id === oldestId) &&
            cursors.size < maxPages &&
            !cursors.has(next.nextCursor)
          ) {
            cursors.add(next.nextCursor);
            const older = await getNotifications(
              { limit: 20, unreadOnly: filter.current, cursor: next.nextCursor },
              abort.signal,
            );
            if (!active.current || request !== sequence.current) {
              return;
            }
            next = mergeNotificationPage(next, older);
          }
        }
        commitPage(
          cursor && current
            ? mergeNotificationPage(current, next)
            : background && !reconcile
              ? refreshNotificationPage(current, next, filter.current)
              : next,
        );
        setError(null);
        setSyncFailed(false);
        setNeedsRefresh(false);
        reconcileRequired.current = false;
        forbidden.current = false;
      } catch (caught: unknown) {
        if (!active.current || request !== sequence.current || abort.signal.aborted) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 403) {
          commitPage(null);
          setError('forbidden');
          setNeedsRefresh(true);
          reconcileRequired.current = true;
          forbidden.current = true;
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
    [cancelRead, commitPage],
  );

  useEffect(() => {
    active.current = true;
    void load();
    const refresh = () => void load({ background: true });
    const resume = () => {
      if (document.hidden) {
        cancelRead();
      } else {
        refresh();
      }
    };
    const timer = setInterval(refresh, NOTIFICATION_POLL_INTERVAL_MS);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    const unsubscribe = subscribeNotificationsChanged(userId, refresh, () => {
      // A peer can read a row beyond the first page (or mark all read). Reconcile the loaded window
      // as well as the badge, including signals received while this tab is hidden or busy.
      reconcileRequired.current = true;
      refresh();
    });
    return () => {
      active.current = false;
      sequence.current += 1;
      controller.current?.abort();
      gate.current = null;
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [cancelRead, load, userId]);

  function changeFilter(next: boolean): void {
    cancelRead();
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
    cancelRead();
    if (gate.current) {
      return;
    }
    setBusy(cursor ? 'more' : 'load');
    setError(null);
    void load(cursor === undefined ? {} : { cursor });
  }

  function refresh(): void {
    void load({ background: true });
  }

  function markRead(notificationId: string | null): Promise<void> {
    // Booking links remain usable while another receipt is saving. Serialize their writes instead
    // of dropping them; the data hook survives dashboard navigation and owns the pending queue.
    const pending = writeQueue.current.then(() => saveRead(notificationId));
    writeQueue.current = pending;
    return pending;
  }

  function openBooking(notificationId: string): void {
    rememberNotificationOpen(userId, notificationId);
    void markRead(notificationId);
  }

  async function saveRead(notificationId: string | null): Promise<void> {
    if (!active.current || forbidden.current) {
      return;
    }
    cancelRead(true);
    if (reconcileRequired.current) {
      await load({ background: true });
    }
    const previous = snapshot.current;
    if (!active.current || gate.current || !previous || reconcileRequired.current) {
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
      // Account changes may unmount this hook while a successful write still needs to notify peers.
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
        forbidden.current = caught instanceof ApiError && caught.status === 403;
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
    refresh,
    markRead,
    openBooking,
  };
}

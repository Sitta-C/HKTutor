'use client';

import { useEffect, useState } from 'react';

import { getUnreadMessageCount } from '@/lib/api/conversations';
import { UNREAD_MESSAGES_CHANGED_EVENT } from '@/lib/conversation-events';

export const UNREAD_MESSAGE_POLL_INTERVAL_MS = 15_000;

export function useUnreadMessageCount(userId: string | null, route: string): number | null {
  const [snapshot, setSnapshot] = useState<{ userId: string; total: number | null } | null>(null);

  useEffect(() => {
    if (!userId) {
      return;
    }
    let active = true;
    let revision = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cancel = () => {
      revision += 1;
      controller?.abort();
      clearTimeout(timer);
    };
    const refresh = async () => {
      cancel();
      if (!active || document.visibilityState !== 'visible') {
        return;
      }
      const requestRevision = revision;
      const request = new AbortController();
      controller = request;
      try {
        const result = await getUnreadMessageCount(request.signal);
        if (active && requestRevision === revision && !request.signal.aborted) {
          const total = result.unreadCount;
          if (!Number.isSafeInteger(total) || total < 0) {
            throw new Error('Invalid unread message count');
          }
          setSnapshot({ userId, total });
        }
      } catch {
        if (active && requestRevision === revision && !request.signal.aborted) {
          setSnapshot({ userId, total: null });
        }
      } finally {
        if (active && requestRevision === revision && document.visibilityState === 'visible') {
          timer = setTimeout(() => void refresh(), UNREAD_MESSAGE_POLL_INTERVAL_MS);
        }
      }
    };
    const refreshNow = () => void refresh();
    void refresh();
    window.addEventListener('focus', refreshNow);
    document.addEventListener('visibilitychange', refreshNow);
    window.addEventListener(UNREAD_MESSAGES_CHANGED_EVENT, refreshNow);
    return () => {
      active = false;
      cancel();
      window.removeEventListener('focus', refreshNow);
      document.removeEventListener('visibilitychange', refreshNow);
      window.removeEventListener(UNREAD_MESSAGES_CHANGED_EVENT, refreshNow);
    };
  }, [userId, route]);

  return userId && snapshot?.userId === userId ? snapshot.total : null;
}

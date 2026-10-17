'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { MarkAllReadButton } from '@/components/notifications/mark-all-read-button';
import { notificationCopy } from '@/components/notifications/notification-copy';
import { NotificationItem } from '@/components/notifications/notification-item';
import {
  mergeNotificationPage,
  optimisticNotificationRead,
} from '@/components/notifications/notification-model';
import { UnreadBadge } from '@/components/notifications/unread-badge';
import { WashiTape } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { ApiError } from '@/lib/api/error';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications';
import { useLanguage } from '@/lib/i18n';

import styles from './notification.module.css';

import type { NotificationPage } from '@/lib/api/types';

type InboxError = 'loadFailed' | 'saveFailed' | 'forbidden' | 'missing';

export function NotificationInbox({ role }: { role: 'STUDENT' | 'TUTOR' }) {
  const { language } = useLanguage();
  const text = notificationCopy[language];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [busy, setBusy] = useState<'load' | 'more' | 'write' | null>('load');
  const [error, setError] = useState<InboxError | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const gate = useRef(false);
  const sequence = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  const load = useCallback((cursor?: string): Promise<void> => {
    if (gate.current) {
      return Promise.resolve();
    }
    gate.current = true;
    const request = ++sequence.current;
    return getNotifications({ limit: 20, ...(cursor ? { cursor } : {}) })
      .then((result) => {
        if (request !== sequence.current) {
          return;
        }
        setPage((current) => (cursor && current ? mergeNotificationPage(current, result) : result));
        setNeedsRefresh(false);
      })
      .catch((caught: unknown) => {
        if (request !== sequence.current) {
          return;
        }
        if (caught instanceof ApiError && caught.status === 403) {
          setPage(null);
          setError('forbidden');
          setNeedsRefresh(true);
        } else {
          setError('loadFailed');
        }
      })
      .finally(() => {
        if (request === sequence.current) {
          gate.current = false;
          setBusy(null);
        }
      });
  }, []);

  function reload(cursor?: string): void {
    if (gate.current) {
      return;
    }
    setBusy(cursor ? 'more' : 'load');
    setError(null);
    if (!cursor) {
      setPage(null);
    }
    void load(cursor);
  }

  useEffect(() => {
    void load();
    return () => {
      // Ignore old responses after unmount/account changes, including Strict Mode replays.
      sequence.current += 1;
      gate.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!open) {
      return;
    }
    close.current?.focus();
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markRead(notificationId: string | null): Promise<boolean> {
    if (gate.current || !page || needsRefresh) {
      return false;
    }
    if (notificationId !== null && page.items.find((item) => item.id === notificationId)?.readAt) {
      return true;
    }
    gate.current = true;
    const request = ++sequence.current;
    const previous = page;
    const optimistic = optimisticNotificationRead(page, notificationId, new Date().toISOString());
    setPage(optimistic);
    setBusy('write');
    setError(null);
    try {
      const result =
        notificationId === null
          ? await markAllNotificationsRead()
          : await markNotificationRead(notificationId);
      if (request !== sequence.current) {
        return false;
      }
      if (result.readAt !== null) {
        const readAt = result.readAt;
        setPage({
          ...optimistic,
          items: optimistic.items.map((item) =>
            previous.items.some((before) => before.id === item.id && before.readAt === null) &&
            (notificationId === null || item.id === notificationId)
              ? { ...item, readAt }
              : item,
          ),
        });
      }
      return true;
    } catch (caught: unknown) {
      if (request === sequence.current) {
        setPage(previous);
        // A lost response may have committed. Reconcile before allowing another mutation.
        setNeedsRefresh(true);
        setError(
          caught instanceof ApiError && caught.status === 403
            ? 'forbidden'
            : caught instanceof ApiError && caught.status === 404
              ? 'missing'
              : 'saveFailed',
        );
      }
      return false;
    } finally {
      if (request === sequence.current) {
        gate.current = false;
        setBusy(null);
      }
    }
  }

  const unreadLabel = page ? text.unreadCount.replace('{count}', String(page.unreadCount)) : '';
  const disabled = busy !== null || needsRefresh;

  return (
    <div
      className={`${styles.container} ${role === 'STUDENT' ? styles.student : ''}`}
      ref={container}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={`${text.title}${page && page.unreadCount > 0 ? `, ${unreadLabel}` : ''}`}
        aria-expanded={open}
        aria-controls="dashboard-notifications"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            reload();
          }
        }}
      >
        <DashboardIcon name="bell" />
        {page && <UnreadBadge count={page.unreadCount} label={unreadLabel} />}
      </button>
      {open && (
        <section
          id="dashboard-notifications"
          className={styles.inbox}
          aria-labelledby="dashboard-notifications-title"
        >
          <WashiTape tone="yellow" className="-top-2 left-1/2 -translate-x-1/2" />
          <header className={styles.header}>
            <div>
              <h2 id="dashboard-notifications-title">{text.title}</h2>
              {page && <p aria-live="polite">{page.unreadCount ? unreadLabel : text.caughtUp}</p>}
            </div>
            <button
              type="button"
              ref={close}
              className={styles.close}
              aria-label={text.close}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <DashboardIcon name="close" />
            </button>
          </header>
          {page && page.unreadCount > 0 && (
            <div className={styles.toolbar}>
              <MarkAllReadButton
                label={text.markAll}
                disabled={disabled}
                onClick={() => void markRead(null)}
              />
            </div>
          )}
          {busy === 'load' ? (
            <div className={styles.message}>
              <NotebookLoadingRegion label={text.loading} />
            </div>
          ) : page ? (
            <>
              {page.items.length ? (
                <ul className={styles.items}>
                  {page.items.map((item) => (
                    <NotificationItem
                      key={item.id}
                      item={item}
                      language={language}
                      disabled={disabled}
                      onRead={() => void markRead(item.id)}
                      onOpen={async (href) => {
                        if (await markRead(item.id)) {
                          setOpen(false);
                          router.push(href);
                        }
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <p className={styles.message}>{text.empty}</p>
              )}
              {page.nextCursor && (
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className={styles.textAction}
                    disabled={disabled}
                    onClick={() => reload(page.nextCursor ?? undefined)}
                  >
                    {busy === 'more' ? text.loading : text.loadMore}
                  </button>
                </div>
              )}
            </>
          ) : null}
          {busy === 'write' && (
            <p className={styles.message} role="status">
              {text.saving}
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {text[error]}
            </p>
          )}
          <footer className={styles.footer}>
            <button
              type="button"
              className={styles.textAction}
              disabled={busy !== null}
              onClick={() => reload()}
            >
              {text.refresh}
            </button>
            <p>{text.timezone}</p>
          </footer>
        </section>
      )}
    </div>
  );
}

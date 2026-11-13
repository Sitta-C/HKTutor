'use client';

import { useEffect, useRef, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { MarkAllReadButton } from '@/components/notifications/mark-all-read-button';
import { notificationCopy } from '@/components/notifications/notification-copy';
import { NotificationItem } from '@/components/notifications/notification-item';
import { UnreadBadge } from '@/components/notifications/unread-badge';
import { useNotificationInbox } from '@/components/notifications/use-notification-inbox';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { useLanguage } from '@/lib/i18n';

import styles from './notification.module.css';

export function NotificationInbox({ role, userId }: { role: 'STUDENT' | 'TUTOR'; userId: string }) {
  const { language } = useLanguage();
  const text = notificationCopy[language];
  const [open, setOpen] = useState(false);
  const {
    page,
    busy,
    error,
    needsRefresh,
    syncFailed,
    unreadOnly,
    changeFilter,
    reload,
    markRead,
  } = useNotificationInbox(userId);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const selectedFilter = useRef<HTMLButtonElement>(null);

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

  const unreadLabel = page ? text.unreadCount.replace('{count}', String(page.unreadCount)) : '';
  const disabled = busy !== null || needsRefresh;
  const visibleItems = page?.items.filter((item) => !unreadOnly || item.readAt === null) ?? [];

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
        title={syncFailed ? text.syncFailed : undefined}
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
          <div className={styles.filters} role="group" aria-label={text.filterLabel}>
            {[false, true].map((onlyUnread) => (
              <button
                key={String(onlyUnread)}
                ref={onlyUnread === unreadOnly ? selectedFilter : undefined}
                type="button"
                className={styles.filter}
                aria-pressed={onlyUnread === unreadOnly}
                disabled={busy !== null && onlyUnread !== unreadOnly}
                onClick={() => changeFilter(onlyUnread)}
              >
                {onlyUnread ? text.filterUnread : text.filterAll}
              </button>
            ))}
          </div>
          {page && page.unreadCount > 0 && (
            <div className={styles.toolbar}>
              <MarkAllReadButton
                label={text.markAll}
                disabled={disabled}
                onClick={() => {
                  selectedFilter.current?.focus();
                  void markRead(null);
                }}
              />
            </div>
          )}
          {busy === 'load' ? (
            <div className={styles.message}>
              <NotebookLoadingRegion label={text.loading} />
            </div>
          ) : page ? (
            <>
              {visibleItems.length ? (
                <ul className={styles.items}>
                  {visibleItems.map((item) => (
                    <NotificationItem
                      key={item.id}
                      item={item}
                      language={language}
                      disabled={disabled}
                      onRead={() => {
                        if (unreadOnly) {
                          selectedFilter.current?.focus();
                        }
                        void markRead(item.id);
                      }}
                      onOpen={() => {
                        // The route key dismisses the panel after navigation; keep the Link mounted.
                        void markRead(item.id);
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <p className={styles.message}>{unreadOnly ? text.emptyUnread : text.empty}</p>
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
          {syncFailed && !error && (
            <p className={styles.message} role="status">
              {text.syncFailed}
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

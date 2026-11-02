import Link from 'next/link';
import { useId, useRef } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { notificationCopy } from '@/components/notifications/notification-copy';
import {
  notificationBookingHref,
  notificationDescription,
  notificationReminderKind,
  notificationTitle,
} from '@/components/notifications/notification-model';
import { formatBangkokDateTime } from '@/lib/date-time';

import styles from './notification.module.css';

import type { InboxNotification } from '@/lib/api/types';

export function NotificationItem({
  item,
  language,
  disabled,
  onRead,
  onOpen,
}: {
  item: InboxNotification;
  language: 'en' | 'th';
  disabled: boolean;
  onRead: () => void;
  onOpen: (href: string) => void;
}) {
  const text = notificationCopy[language];
  const summary = useRef<HTMLElement>(null);
  const metadataId = useId();
  const title = notificationTitle(item, language);
  const href = notificationBookingHref(item.bookingId);
  const unread = item.readAt === null;
  const reminderKind = notificationReminderKind(item.eventType);
  return (
    <li className={`${styles.item} ${unread ? styles.unread : ''}`}>
      <details name="dashboard-notification-details" className={styles.details}>
        <summary
          ref={summary}
          className={styles.summary}
          aria-label={`${text.viewDetails}: ${title}`}
          aria-describedby={metadataId}
        >
          <DashboardIcon
            name={
              reminderKind === 'class'
                ? 'clock'
                : reminderKind === 'payment'
                  ? 'bookings'
                  : 'calendar'
            }
            className={`${styles.itemIcon} ${reminderKind === 'payment' ? styles.paymentIcon : ''}`}
          />
          <span className={styles.itemContent}>
            <span className={styles.itemTitle}>{title}</span>
            <span id={metadataId} className={styles.itemMetadata}>
              <time dateTime={item.createdAt} className={styles.timestamp}>
                {formatBangkokDateTime(item.createdAt, language)}
              </time>
              <span className={styles.readState}>{unread ? text.unread : text.read}</span>
            </span>
          </span>
          <span className={styles.chevron} aria-hidden="true" />
        </summary>
        <div className={styles.itemDetails}>
          <p className={styles.description}>{notificationDescription(item, language)}</p>
          <div className={styles.itemActions}>
            {href ? (
              <Link
                href={href}
                prefetch={false}
                className={styles.bookingLink}
                aria-label={`${text.openBooking}: ${title}`}
                aria-disabled={disabled}
                onClick={(event) => {
                  if (disabled) {
                    event.preventDefault();
                  }
                }}
                onNavigate={(event) => {
                  event.preventDefault();
                  if (!disabled) {
                    onOpen(href);
                  }
                }}
              >
                {text.openBooking}
              </Link>
            ) : (
              <p className={styles.missing}>{text.missingBooking}</p>
            )}
            {unread && (
              <button
                type="button"
                className={styles.textAction}
                disabled={disabled}
                onClick={() => {
                  summary.current?.focus();
                  onRead();
                }}
              >
                {text.markRead}
              </button>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

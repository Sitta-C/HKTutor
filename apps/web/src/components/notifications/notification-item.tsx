import Link from 'next/link';

import { notificationCopy } from '@/components/notifications/notification-copy';
import {
  notificationBookingHref,
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
  const title = notificationTitle(item, language);
  const href = notificationBookingHref(item.bookingId);
  const unread = item.readAt === null;
  return (
    <li className={`${styles.item} ${unread ? styles.unread : ''}`}>
      <div className={styles.itemHeading}>
        <h3>{title}</h3>
        <span className={styles.readState}>{unread ? text.unread : text.read}</span>
      </div>
      <time dateTime={item.createdAt} className={styles.timestamp}>
        {formatBangkokDateTime(item.createdAt, language)}
      </time>
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
          <button type="button" className={styles.textAction} disabled={disabled} onClick={onRead}>
            {text.markRead}
          </button>
        )}
      </div>
    </li>
  );
}

import { formatBookingDocketSlot } from '@/components/bookings/booking-docket-model';
import { formatDuration, formatMoney } from '@/components/bookings/booking-ui';
import { StatusBadge } from '@/components/ui/notebook';
import { formatBangkokDateParts } from '@/lib/date-time';

import styles from './booking-docket.module.css';

import type { BookingRequestCopy } from '@/components/bookings/booking-request-copy';
import type { BookingLanguage, BookingText } from '@/components/bookings/booking-ui';
import type { BookingQuote, BookingResponse, BookingStatus } from '@/lib/api/types';
import type { ReactElement } from 'react';

// Presentation only: quote and booking-detail consumers can supply their existing response data.
export function BookingDocketSummary({
  summary,
  amounts,
  language,
  text,
  requestText,
  presentation = 'request',
  timeLabel = requestText.time,
}: {
  summary: Pick<BookingQuote, 'tutor' | 'listing' | 'slot'>;
  amounts: Pick<BookingResponse, 'subtotalAmount' | 'discountAmount' | 'currency'>;
  language: BookingLanguage;
  text: BookingText;
  requestText: BookingRequestCopy;
  presentation?: 'request' | 'detail';
  timeLabel?: string;
}): ReactElement {
  const { tutor, listing, slot } = summary;
  const date = formatBangkokDateParts(slot.startAtUtc, language);
  const time = formatBookingDocketSlot(slot, language);
  const verified = tutor.verificationStatus === 'VERIFIED';
  const initials =
    tutor.displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toUpperCase() || '?';

  const timeRail = (
    <div className={styles.timeRail}>
      <div className={styles.calendar} aria-hidden="true">
        <span>{date.month}</span>
        <strong>{date.day}</strong>
        <small>{date.year}</small>
      </div>
      <div className={styles.timeBody}>
        <p className={styles.label}>{timeLabel}</p>
        <div role="group" aria-label={time.label}>
          {time.endDate ? (
            <div className={styles.endpoints} aria-hidden="true">
              <div>
                <span className={styles.label}>{requestText.start}</span>
                <time dateTime={slot.startAtUtc}>{time.start}</time>
                <p>{time.startDate}</p>
              </div>
              <div>
                <span className={styles.label}>{requestText.end}</span>
                <time dateTime={slot.endAtUtc}>{time.end}</time>
                <p>{time.endDate}</p>
              </div>
            </div>
          ) : (
            <div aria-hidden="true">
              <p className={styles.clock}>
                <time dateTime={slot.startAtUtc}>{time.start}</time>–
                <time dateTime={slot.endAtUtc}>{time.end}</time>
              </p>
              <p className={styles.date}>{time.startDate}</p>
            </div>
          )}
        </div>
        <p className={styles.duration}>{formatDuration(slot.startAtUtc, slot.endAtUtc, text)}</p>
        <p className={styles.zone}>{text.bangkokTime}</p>
      </div>
    </div>
  );
  const courseContent = (
    <div className={styles.content}>
      <div className={styles.person}>
        <span className={styles.avatar} aria-hidden="true">
          {initials}
        </span>
        <div className="min-w-0">
          <h2>{tutor.displayName}</h2>
          <p className={verified ? styles.verified : styles.label}>
            {verified ? requestText.verified : requestText.verificationUnavailable}
          </p>
        </div>
      </div>
      <div className={styles.offer}>
        <div>
          <p className={styles.grade}>{listing.gradeLevelName}</p>
          <h3>{listing.subjectName}</h3>
        </div>
        {presentation === 'request' && (
          <div className={styles.rate}>
            <strong>{formatMoney(listing.pricePerHour, amounts.currency)}</strong>
            <span>/ {requestText.hour}</span>
          </div>
        )}
      </div>
      <p className={styles.description}>{listing.description}</p>
      {presentation === 'request' && <BookingDocketAmounts amounts={amounts} text={text} />}
    </div>
  );

  return (
    <div
      className={
        presentation === 'detail' ? `${styles.summary} ${styles.detailSummary}` : styles.summary
      }
      data-booking-summary
    >
      {presentation === 'detail' ? (
        <>
          {courseContent}
          {timeRail}
        </>
      ) : (
        <>
          {timeRail}
          {courseContent}
        </>
      )}
    </div>
  );
}

export function BookingDocketAmounts({
  amounts,
  text,
}: {
  amounts: Pick<BookingResponse, 'subtotalAmount' | 'discountAmount' | 'currency'>;
  text: BookingText;
}): ReactElement {
  return (
    <dl className={styles.amounts}>
      <div>
        <dt>{text.subtotal}</dt>
        <dd>{formatMoney(amounts.subtotalAmount, amounts.currency)}</dd>
      </div>
      <div>
        <dt>{text.discount}</dt>
        <dd>{formatMoney(amounts.discountAmount, amounts.currency)}</dd>
      </div>
    </dl>
  );
}

export function BookingDocketTotal({
  amount,
  currency,
  label,
}: {
  amount: string;
  currency: string;
  label: string;
}): ReactElement {
  return (
    <div className={styles.total}>
      <span>{label}</span>
      <strong>
        {amount} <small>{currency}</small>
      </strong>
    </div>
  );
}

export function BookingDocketStatus({
  status,
  text,
  appearance = 'badge',
}: {
  status: BookingStatus;
  text: BookingRequestCopy;
  appearance?: 'badge' | 'tag';
}): ReactElement {
  const tones = {
    PENDING: 'warning',
    CONFIRMED: 'success',
    COMPLETED: 'neutral',
    CANCELED: 'danger',
    EXPIRED: 'danger',
  } as const;
  const labels = {
    PENDING: text.pending,
    CONFIRMED: text.confirmed,
    COMPLETED: text.completed,
    CANCELED: text.canceled,
    EXPIRED: text.expired,
  };
  if (appearance === 'tag') {
    return (
      <span className={styles.statusTag} data-booking-status={status}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {status === 'PENDING' ? (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </>
          ) : status === 'CONFIRMED' ? (
            <path d="m20 6-11 11-5-5" />
          ) : status === 'COMPLETED' ? (
            <path d="m18 6-11 11-5-5M22 10l-7 7-4-4" />
          ) : (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="m5.6 5.6 12.8 12.8" />
            </>
          )}
        </svg>
        <span>{labels[status]}</span>
      </span>
    );
  }
  return <StatusBadge tone={tones[status]}>{labels[status]}</StatusBadge>;
}

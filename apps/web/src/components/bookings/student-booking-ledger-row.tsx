import Link from 'next/link';

import { BookingDocketStatus } from '@/components/bookings/booking-docket';
import { formatBookingDocketSlot } from '@/components/bookings/booking-docket-model';
import { bookingRequestCopy } from '@/components/bookings/booking-request-copy';
import { formatMoney } from '@/components/bookings/booking-ui';
import { studentBookingsCopy } from '@/components/bookings/student-bookings-copy';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';

import styles from './student-bookings.module.css';

import type { BookingLanguage, BookingText } from '@/components/bookings/booking-ui';
import type { BookingView } from '@/lib/api/types';

export function StudentBookingLedgerRow({
  booking,
  language,
  text,
}: {
  booking: BookingView;
  language: BookingLanguage;
  text: BookingText;
}) {
  const time = formatBookingDocketSlot(booking.slot, language);
  const requestText = bookingRequestCopy[language];
  const titleId = `booking-${booking.id}`;

  return (
    <article className={styles.row} aria-labelledby={titleId} data-booking-row>
      <div className={styles.dateRow} role="group" aria-label={time.label}>
        {time.endDate ? (
          <div className={styles.endpoints} aria-hidden="true">
            <div>
              <span>{requestText.start}</span>
              <time dateTime={booking.slot.startAtUtc}>{time.start}</time>
              <p>{time.startDate}</p>
            </div>
            <div>
              <span>{requestText.end}</span>
              <time dateTime={booking.slot.endAtUtc}>{time.end}</time>
              <p>{time.endDate}</p>
            </div>
          </div>
        ) : (
          <div className={styles.datePair} aria-hidden="true">
            <p>{time.startDate}</p>
            <strong>
              <time dateTime={booking.slot.startAtUtc}>{time.start}</time>–
              <time dateTime={booking.slot.endAtUtc}>{time.end}</time>
            </strong>
          </div>
        )}
      </div>
      <div className={styles.course}>
        <p className={styles.grade}>{booking.listing.gradeLevelName}</p>
        <h2 id={titleId}>{booking.listing.subjectName}</h2>
        <p className={styles.tutor}>{booking.tutor.displayName}</p>
      </div>
      <div className={styles.rowStub}>
        <BookingDocketStatus status={booking.status} text={requestText} appearance="tag" />
        <p className={styles.amount}>
          <span className="sr-only">{studentBookingsCopy[language].amount}: </span>
          {formatMoney(booking.netAmount, booking.currency)}
        </p>
        <Link
          href={`/dashboard/bookings/${encodeURIComponent(booking.id)}`}
          className={styles.rowTicket}
          aria-label={`${requestText.details}: ${booking.tutor.displayName}, ${booking.listing.subjectName}`}
        >
          <span className={styles.ticketLabel}>{studentBookingsCopy[language].view}</span>
          <span className={styles.ticketStub} aria-hidden="true">
            <DashboardIcon name="arrow-right" className="h-4 w-4" />
          </span>
        </Link>
      </div>
      <span className="sr-only">{text.bangkokTime}</span>
    </article>
  );
}

'use client';

import { formatBookingDocketSlot } from '@/components/bookings/booking-docket-model';
import { bookingRequestCopy } from '@/components/bookings/booking-request-copy';
import { BookingStatusBadge, formatMoney } from '@/components/bookings/booking-ui';
import {
  getStudentLabel,
  isDecidableBooking,
} from '@/components/bookings/tutor-booking-inbox-model';
import { NotebookAction } from '@/components/ui/notebook-action';

import styles from './tutor-booking-inbox.module.css';

import type { BookingText } from '@/components/bookings/booking-ui';
import type { TutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import type {
  TutorBookingDecision,
  TutorBookingDecisionError,
} from '@/components/bookings/tutor-booking-inbox-model';
import type { TutorBookingView } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export interface TutorBookingCardProps {
  booking: TutorBookingView;
  copy: TutorBookingInboxCopy;
  /** Shared app-wide booking status labels, so a status reads the same for both roles. */
  statusText: BookingText;
  decisionError: TutorBookingDecisionError | null;
  /** The decision currently in flight for this booking, so only that action reports progress. */
  submittingDecision: TutorBookingDecision | null;
  language: Language;
  onDecide: (decision: TutorBookingDecision) => void;
  onRefresh: () => void;
}

export function TutorBookingCard({
  booking,
  copy,
  statusText,
  decisionError,
  submittingDecision,
  language,
  onDecide,
  onRefresh,
}: TutorBookingCardProps) {
  const studentLabel = getStudentLabel(booking, copy);
  const time = formatBookingDocketSlot(booking.slot, language);
  // Only the cross-day Start/End wording comes from the shared request copy.
  const rangeText = bookingRequestCopy[language];
  const titleId = `tutor-booking-${booking.id}`;
  const isSubmitting = submittingDecision !== null;
  const isPending = isDecidableBooking(booking);
  // A stale row is locked until the inbox reloads, so one failed decision cannot be retried blindly.
  const isStale = decisionError?.requiresRefresh === true;
  const canDecide = isPending && !isStale;

  return (
    <article className={styles.row} aria-labelledby={titleId} aria-busy={isSubmitting}>
      <div className={styles.dateRow} role="group" aria-label={time.label}>
        {time.endDate ? (
          <div className={styles.endpoints} aria-hidden="true">
            <div>
              <span>{rangeText.start}</span>
              <time dateTime={booking.slot.startAtUtc}>{time.start}</time>
              <p>{time.startDate}</p>
            </div>
            <div>
              <span>{rangeText.end}</span>
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
        <h2 id={titleId}>{studentLabel}</h2>
        <p className={styles.subject}>{booking.listing.subjectName}</p>
      </div>

      <div className={styles.rowStub}>
        <BookingStatusBadge status={booking.status} text={statusText} />
        <p className={styles.amount}>
          <span className="sr-only">{copy.amount}: </span>
          {formatMoney(booking.netAmount, booking.currency)}
        </p>
        {canDecide ? (
          <div className={styles.actions}>
            <NotebookAction
              tone="secondary"
              size="compact"
              className={styles.action}
              disabled={isSubmitting}
              aria-label={copy.rejectFor.replace('{student}', studentLabel)}
              onClick={() => onDecide('REJECT')}
            >
              {submittingDecision === 'REJECT' ? copy.working : copy.rejectAction}
            </NotebookAction>
            <NotebookAction
              tone="primary"
              size="compact"
              className={styles.action}
              disabled={isSubmitting}
              aria-label={copy.confirmFor.replace('{student}', studentLabel)}
              onClick={() => onDecide('CONFIRM')}
            >
              {submittingDecision === 'CONFIRM' ? copy.working : copy.confirmAction}
            </NotebookAction>
          </div>
        ) : (
          <p className={styles.decided}>{copy.decidedHint}</p>
        )}
      </div>

      {decisionError && (
        <p className={styles.notice} role="alert">
          {decisionError.message}
          {decisionError.requiresRefresh && (
            <>
              {' '}
              <button type="button" className={styles.noticeAction} onClick={onRefresh}>
                {copy.refresh}
              </button>
            </>
          )}
        </p>
      )}

      <span className="sr-only">{copy.bangkokTime}</span>
    </article>
  );
}

export default TutorBookingCard;

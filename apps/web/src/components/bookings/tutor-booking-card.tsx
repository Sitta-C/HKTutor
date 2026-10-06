'use client';

import {
  BookingStatusBadge,
  formatBangkokDateTime,
  formatBangkokRange,
  formatDuration,
  formatMoney,
} from '@/components/bookings/booking-ui';
import {
  getStudentLabel,
  isDecidableBooking,
} from '@/components/bookings/tutor-booking-inbox-model';
import { PaperCard, WashiTape, notebookButtonClass } from '@/components/ui/notebook';

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
  /** Shared app-wide booking status labels, reused so a status reads the same for both roles. */
  statusText: BookingText;
  decisionError: TutorBookingDecisionError | null;
  /** The decision currently in flight for this booking, so only that button reports progress. */
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
  const isSubmitting = submittingDecision !== null;
  const isPending = isDecidableBooking(booking);
  // A stale row is locked until the inbox reloads, so one failed decision cannot be retried blindly.
  const isStale = decisionError?.requiresRefresh === true;
  const canDecide = isPending && !isStale;

  return (
    <PaperCard className="relative overflow-hidden p-4 shadow-sm sm:p-5" aria-busy={isSubmitting}>
      <WashiTape
        tone={isPending ? 'blue' : 'yellow'}
        className="-right-5 -top-1 rotate-12 opacity-65"
      />
      <div className="flex flex-wrap items-start gap-4 sm:flex-nowrap">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-tutor-deep font-extrabold text-white shadow-sm"
          aria-hidden="true"
        >
          {getStudentInitial(studentLabel)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-extrabold text-notebook-ink">{studentLabel}</h3>
          <p className="mt-1 text-sm font-semibold text-notebook-ink">
            {booking.listing.subjectName} · {booking.listing.gradeLevelName}
          </p>
          <p className="mt-1 text-sm text-notebook-muted">
            {formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)} ·{' '}
            {formatDuration(booking.slot.startAtUtc, booking.slot.endAtUtc, statusText)}
          </p>
          <p className="mt-1 text-xs text-notebook-muted">
            {copy.bangkokTime} · {copy.requested}{' '}
            {formatBangkokDateTime(booking.createdAt, language)}
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col items-start gap-1 sm:w-auto sm:items-end">
          <BookingStatusBadge status={booking.status} text={statusText} />
          <p className="text-sm font-extrabold text-notebook-ink">
            {formatMoney(booking.netAmount, booking.currency)}
          </p>
          <p className="text-xs text-notebook-muted">{copy.amount}</p>
        </div>
      </div>

      {canDecide && (
        <div className="mt-4 flex flex-col gap-2 border-t border-dashed border-paper-edge pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isSubmitting}
            aria-label={copy.rejectFor.replace('{student}', studentLabel)}
            onClick={() => onDecide('REJECT')}
            className={notebookButtonClass({
              tone: 'secondary',
              className: 'border-red-200 text-red-700 hover:bg-red-50 sm:min-w-32',
            })}
          >
            {submittingDecision === 'REJECT' ? copy.working : copy.rejectAction}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            aria-label={copy.confirmFor.replace('{student}', studentLabel)}
            onClick={() => onDecide('CONFIRM')}
            className={notebookButtonClass({ className: 'sm:min-w-32' })}
          >
            {submittingDecision === 'CONFIRM' ? copy.working : copy.confirmAction}
          </button>
        </div>
      )}

      {!isPending && (
        <p className="mt-4 border-t border-dashed border-paper-edge pt-4 text-xs text-notebook-muted">
          <span className="font-bold text-notebook-ink">{copy.decidedLabel}</span> ·{' '}
          {copy.decidedHint}
        </p>
      )}

      {decisionError && (
        <div
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          <p className="font-semibold">{decisionError.message}</p>
          {decisionError.requiresRefresh && (
            <button type="button" onClick={onRefresh} className="mt-2 font-bold underline">
              {copy.refresh}
            </button>
          )}
        </div>
      )}
    </PaperCard>
  );
}

function getStudentInitial(studentLabel: string): string {
  return studentLabel.trim().charAt(0).toUpperCase() || '?';
}

export default TutorBookingCard;

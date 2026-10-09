'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { formatBangkokRange, formatMoney } from '@/components/bookings/booking-ui';
import {
  MAX_BOOKING_DECISION_TEXT_LENGTH,
  getStudentLabel,
  validateDecisionText,
} from '@/components/bookings/tutor-booking-inbox-model';
import { WashiTape } from '@/components/ui/notebook';
import { NotebookAction } from '@/components/ui/notebook-action';

import type { TutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import type { TutorBookingDecision } from '@/components/bookings/tutor-booking-inbox-model';
import type { TutorBookingView } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';
import type { FormEvent } from 'react';

export interface BookingDecisionDialogProps {
  booking: TutorBookingView;
  copy: TutorBookingInboxCopy;
  decision: TutorBookingDecision;
  errorMessage: string | null;
  isSubmitting: boolean;
  language: Language;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}

/**
 * Asks the tutor to confirm one pending decision before it is sent. The parent mounts one dialog
 * per target so a rejection reason never carries over to another booking.
 */
export function BookingDecisionDialog({
  booking,
  copy,
  decision,
  errorMessage,
  isSubmitting,
  language,
  onCancel,
  onSubmit,
}: BookingDecisionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const textId = useId();
  const [text, setText] = useState('');
  const [showTextError, setShowTextError] = useState(false);
  const isConfirm = decision === 'CONFIRM';
  const textError = validateDecisionText(text, copy);
  const studentLabel = getStudentLabel(booking, copy);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (textError) {
      setShowTextError(true);
      return;
    }
    onSubmit(text);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // An in-flight decision must not be dismissed while the server answer is still unknown.
        if (isSubmitting) event.preventDefault();
      }}
      onClose={onCancel}
      className="m-auto w-[min(92vw,540px)] overflow-visible rounded-[1.5rem] border border-paper-edge bg-paper p-0 text-notebook-ink shadow-paper backdrop:bg-stone-900/45"
    >
      <WashiTape
        tone={isConfirm ? 'blue' : 'pink'}
        className="left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2"
      />
      <form onSubmit={handleSubmit} className="px-6 py-6 sm:px-8 sm:py-7">
        <h2 id={titleId} className="text-2xl font-bold tracking-[-0.03em]">
          {isConfirm ? copy.confirmTitle : copy.rejectTitle}
        </h2>
        <p id={bodyId} className="mt-2 text-sm leading-6 text-notebook-muted">
          {isConfirm ? copy.confirmBody : copy.rejectBody}
        </p>

        <dl className="mt-5 space-y-1.5 rounded-xl border border-dashed border-paper-edge bg-paper-deep/60 p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="font-bold text-notebook-ink">{studentLabel}</dt>
            <dd className="font-semibold text-notebook-muted">
              {booking.listing.subjectName} · {booking.listing.gradeLevelName}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-notebook-muted">{copy.lessonTime}</dt>
            <dd className="font-semibold text-notebook-ink">
              {formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-notebook-muted">{copy.amount}</dt>
            <dd className="font-semibold text-notebook-ink">
              {formatMoney(booking.netAmount, booking.currency)}
            </dd>
          </div>
        </dl>

        {/* Only a rejection collects text: the API stores the reason but discards a confirm note. */}
        {!isConfirm && (
          <div className="mt-5">
            <label htmlFor={textId} className="mb-1.5 block text-sm font-bold text-notebook-ink">
              {copy.reasonLabel}
            </label>
            <textarea
              id={textId}
              autoFocus
              rows={3}
              value={text}
              maxLength={MAX_BOOKING_DECISION_TEXT_LENGTH}
              disabled={isSubmitting}
              placeholder={copy.reasonPlaceholder}
              aria-describedby={`${textId}-hint`}
              aria-invalid={showTextError && textError !== null}
              onChange={(event) => {
                setText(event.target.value);
                setShowTextError(false);
              }}
              className="w-full rounded-lg border border-paper-edge bg-paper px-4 py-3 text-[0.98rem] leading-6 text-notebook-ink outline-none transition placeholder:text-stone-400 hover:border-stone-400 focus:border-notebook-ink focus:ring-4 focus:ring-sticky-yellow/60 disabled:opacity-60"
            />
            {showTextError && textError ? (
              <p className="mt-1.5 text-xs font-medium text-red-700" role="alert">
                {textError}
              </p>
            ) : (
              <p id={`${textId}-hint`} className="mt-1.5 text-xs text-notebook-muted">
                {copy.textHint.replace('{max}', String(MAX_BOOKING_DECISION_TEXT_LENGTH))} (
                {text.length}/{MAX_BOOKING_DECISION_TEXT_LENGTH})
              </p>
            )}
          </div>
        )}

        {errorMessage && (
          <p
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"
            role="alert"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <NotebookAction tone="secondary" disabled={isSubmitting} onClick={onCancel}>
            {copy.cancel}
          </NotebookAction>
          {/* Red stays for the destructive confirmation; confirming keeps the tutor ink ticket. */}
          <NotebookAction
            type="submit"
            tone={isConfirm ? 'primary' : 'danger'}
            aria-busy={isSubmitting}
            disabled={isSubmitting}
          >
            {isSubmitting ? copy.working : isConfirm ? copy.confirmSubmit : copy.rejectSubmit}
          </NotebookAction>
        </div>
      </form>
    </dialog>
  );
}

export default BookingDecisionDialog;

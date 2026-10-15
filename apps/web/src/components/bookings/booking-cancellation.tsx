'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { bookingCancellationCopy } from '@/components/bookings/booking-cancellation-copy';
import {
  getCancellationEligibility,
  getCancellationFailure,
} from '@/components/bookings/booking-cancellation-model';
import { formatBangkokRange } from '@/components/bookings/booking-ui';
import { NotebookAction } from '@/components/ui/notebook-action';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { cancelBooking } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import type { CancellationBooking } from '@/components/bookings/booking-cancellation-model';
import type { CancelBookingResult } from '@/lib/api/types';
import type { FormEvent } from 'react';

export function BookingCancellation({
  booking,
  disabled = false,
  onCanceled,
  onRefresh,
  onRequiresRefresh,
}: {
  booking: CancellationBooking;
  disabled?: boolean;
  onCanceled: (result: CancelBookingResult) => void;
  onRefresh: () => void;
  onRequiresRefresh?: () => void;
}) {
  const { language } = useLanguage();
  const copy = bookingCancellationCopy[language];
  const toast = useNotebookToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const id = useId();
  const [now, setNow] = useState(() => Date.now());
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ReturnType<typeof getCancellationFailure> | null>(null);
  const eligibility = getCancellationEligibility(booking, now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const close = () => {
    if (inFlight.current) {
      return;
    }
    dialog.current?.close();
    trigger.current?.focus();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || disabled || failure?.requiresRefresh) {
      return;
    }
    const currentEligibility = getCancellationEligibility(booking, Date.now());
    if (currentEligibility !== 'eligible') {
      setNow(Date.now());
      setFailure({ message: copy[currentEligibility], requiresRefresh: true });
      onRequiresRefresh?.();
      return;
    }
    if (!reason.trim()) {
      setFailure({ message: copy.required, requiresRefresh: false });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await cancelBooking(booking.id, reason);
      if (result.bookingId !== booking.id || result.status !== 'CANCELED') {
        setFailure({ message: copy.uncertain, requiresRefresh: true });
        onRequiresRefresh?.();
        return;
      }
      dialog.current?.close();
      trigger.current?.focus();
      toast.success(copy.success);
      onCanceled(result);
    } catch (error: unknown) {
      const nextFailure = getCancellationFailure(error, copy);
      setFailure(nextFailure);
      if (nextFailure.requiresRefresh) {
        onRequiresRefresh?.();
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <section
      className="min-w-0 space-y-3 border-t border-dashed border-paper-edge p-4"
      aria-label={copy.action}
    >
      <p id={`${id}-eligibility`} className="text-sm text-notebook-muted">
        {copy[eligibility]}
      </p>
      {eligibility === 'eligible' && <p className="text-sm text-notebook-muted">{copy.policy}</p>}
      <NotebookAction
        ref={trigger}
        tone="danger"
        size="compact"
        disabled={disabled || pending || eligibility !== 'eligible' || failure?.requiresRefresh}
        aria-describedby={`${id}-eligibility`}
        onClick={() => {
          setReason('');
          setFailure(null);
          setNow(Date.now());
          dialog.current?.showModal();
        }}
      >
        {copy.action}
      </NotebookAction>
      {failure?.requiresRefresh && (
        <p role="alert" className="text-sm text-red-800">
          {failure.message}
        </p>
      )}
      {(failure?.requiresRefresh || eligibility === 'unavailable') && (
        <NotebookAction
          tone="secondary"
          size="compact"
          disabled={pending}
          onClick={() => {
            close();
            onRefresh();
          }}
        >
          {copy.refresh}
        </NotebookAction>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onCancel={(event) => {
          if (inFlight.current) {
            event.preventDefault();
          }
        }}
        onClose={() => trigger.current?.focus()}
        className="m-auto max-h-[90dvh] w-[min(92vw,540px)] overflow-y-auto rounded-2xl border border-paper-edge bg-paper p-6 text-notebook-ink shadow-paper backdrop:bg-stone-900/45"
      >
        <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
          <h2 id={`${id}-title`} className="text-xl font-bold">
            {copy.title}
          </h2>
          <p id={`${id}-body`} className="text-sm text-notebook-muted">
            {copy.body}
          </p>
          <div className="rounded-lg border border-dashed border-paper-edge p-3 text-sm">
            <p className="font-bold">
              {booking.listing.subjectName} · {booking.listing.gradeLevelName}
            </p>
            <p>{formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)}</p>
          </div>
          <p className="text-sm text-notebook-muted">{copy.policy}</p>
          <label htmlFor={`${id}-reason`} className="block text-sm font-bold">
            {copy.reason}
          </label>
          <textarea
            id={`${id}-reason`}
            rows={3}
            required
            value={reason}
            disabled={pending || failure?.requiresRefresh}
            aria-invalid={failure !== null && !failure.requiresRefresh}
            aria-describedby={failure ? `${id}-error` : undefined}
            onChange={(event) => {
              setReason(event.target.value);
              setFailure(null);
            }}
            className="w-full resize-y rounded-lg border border-paper-edge bg-paper p-3 outline-none focus:ring-4 focus:ring-sticky-yellow/60 disabled:opacity-60"
          />
          {eligibility !== 'eligible' && <p role="alert">{copy[eligibility]}</p>}
          {failure && (
            <p id={`${id}-error`} role="alert" className="text-sm text-red-800">
              {failure.message}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <NotebookAction autoFocus tone="secondary" disabled={pending} onClick={close}>
              {copy.keep}
            </NotebookAction>
            {failure?.requiresRefresh ? (
              <NotebookAction
                disabled={pending}
                onClick={() => {
                  close();
                  onRefresh();
                }}
              >
                {copy.refresh}
              </NotebookAction>
            ) : (
              <NotebookAction
                type="submit"
                tone="danger"
                disabled={pending || eligibility !== 'eligible'}
                aria-busy={pending}
              >
                {pending ? copy.working : copy.confirm}
              </NotebookAction>
            )}
          </div>
        </form>
      </dialog>
    </section>
  );
}

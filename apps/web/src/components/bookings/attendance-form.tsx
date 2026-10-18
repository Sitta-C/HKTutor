'use client';

import { useEffect, useRef, useState } from 'react';

import { classDetailsCopy } from '@/components/bookings/class-details-copy';
import { NotebookAction } from '@/components/ui/notebook-action';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { updateAttendance } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import styles from './class-details.module.css';

import type { AttendanceStatus, SavedAttendanceSummary } from '@/lib/api/types';

export function AttendanceForm({
  bookingId,
  onSaved,
  onBusyChange,
  onUncertain,
  disabled = false,
  disabledMessage,
}: {
  bookingId: string;
  onSaved: (summary: SavedAttendanceSummary) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onUncertain?: (error: unknown) => void;
  disabled?: boolean;
  disabledMessage?: string | undefined;
}) {
  const { language } = useLanguage();
  const text = classDetailsCopy[language];
  const toast = useNotebookToast();
  const [pending, setPending] = useState(false);
  const [selection, setSelection] = useState<AttendanceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(false);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (gate.current || disabled || disabledMessage || selection === null) {
      return;
    }
    gate.current = true;
    setPending(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const summary = await updateAttendance(bookingId, selection);
      if (!active.current) {
        return;
      }
      toast.success(summary.idempotentReplay ? text.attendanceReplay : text.attendanceSaved);
      await onSaved(summary);
    } catch (caught: unknown) {
      if (!active.current) {
        return;
      }
      const code =
        caught instanceof ApiError &&
        caught.details !== null &&
        typeof caught.details === 'object' &&
        'code' in caught.details
          ? caught.details.code
          : undefined;
      // A still-pending booking is 400 (US4-2); every other eligibility change is 409.
      const stateRejected =
        caught instanceof ApiError &&
        (caught.status === 409 ||
          (caught.status === 400 && code === 'BOOKING_NOT_CONFIRMED_OR_COMPLETED'));
      const message = stateRejected
        ? code === 'CLASS_NOT_ENDED'
          ? text.attendanceFuture
          : code === 'BOOKING_NOT_CONFIRMED_OR_COMPLETED'
            ? text.attendanceUnavailable
            : text.attendanceConflict
        : caught instanceof ApiError && caught.status === 403
          ? text.attendanceOwner
          : caught instanceof ApiError && caught.status === 404
            ? text.notFound
            : text.attendanceFailed;
      setError(message);
      toast.error(message);
      onUncertain?.(caught);
    } finally {
      gate.current = false;
      if (active.current) {
        onBusyChange?.(false);
        setPending(false);
      }
    }
  }

  return (
    <section
      className={styles.attendanceForm}
      aria-labelledby="attendance-title"
      aria-busy={pending}
    >
      <h3 id="attendance-title">{text.attendanceTitle}</h3>
      <p className={styles.note} id="attendance-help">
        {disabledMessage ?? text.attendanceHelp}
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset
        className={styles.attendanceChoices}
        disabled={pending || disabled || Boolean(disabledMessage)}
        aria-describedby="attendance-help"
      >
        <legend className={styles.caption}>{text.attendanceChoice}</legend>
        {(['ATTENDED', 'ABSENT'] as const).map((value) => (
          <label className={styles.attendanceChoice} key={value}>
            <input
              type="radio"
              name={`attendance-${bookingId}`}
              value={value}
              checked={selection === value}
              onChange={() => setSelection(value)}
            />
            {value === 'ATTENDED' ? text.attended : text.absent}
          </label>
        ))}
      </fieldset>
      {!disabledMessage && (
        <p className={styles.note} id="attendance-finality">
          {text.attendanceFinality}
        </p>
      )}
      <div className={styles.attendanceActions}>
        <NotebookAction
          type="button"
          size="compact"
          tone={selection === 'ABSENT' ? 'danger' : 'primary'}
          disabled={pending || disabled || Boolean(disabledMessage) || selection === null}
          aria-describedby={disabledMessage ? 'attendance-help' : 'attendance-finality'}
          onClick={() => void save()}
        >
          {pending ? text.attendanceSaving : text.recordAttendance}
        </NotebookAction>
      </div>
    </section>
  );
}

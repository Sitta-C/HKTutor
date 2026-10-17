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
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(false);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function save(attendance: AttendanceStatus): Promise<void> {
    if (gate.current || disabled || disabledMessage) {
      return;
    }
    gate.current = true;
    setPending(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const summary = await updateAttendance(bookingId, attendance);
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
      const message =
        caught instanceof ApiError && caught.status === 409
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
      <p className={styles.note}>{text.attendanceHelp}</p>
      {error && <p role="alert">{error}</p>}
      {disabledMessage && <p className={styles.note}>{disabledMessage}</p>}
      <div className={styles.attendanceActions}>
        <NotebookAction
          type="button"
          size="compact"
          disabled={pending || disabled || Boolean(disabledMessage)}
          onClick={() => void save('ATTENDED')}
        >
          {pending ? text.attendanceSaving : text.attended}
        </NotebookAction>
        <NotebookAction
          type="button"
          size="compact"
          tone="danger"
          disabled={pending || disabled || Boolean(disabledMessage)}
          onClick={() => void save('ABSENT')}
        >
          {text.absent}
        </NotebookAction>
      </div>
    </section>
  );
}

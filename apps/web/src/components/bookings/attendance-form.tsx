'use client';

import { useRef, useState } from 'react';

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
  disabledMessage,
}: {
  bookingId: string;
  onSaved: (summary: SavedAttendanceSummary) => Promise<void>;
  disabledMessage?: string;
}) {
  const { language } = useLanguage();
  const text = classDetailsCopy[language];
  const toast = useNotebookToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(false);

  async function save(attendance: AttendanceStatus): Promise<void> {
    if (gate.current) return;
    gate.current = true;
    setPending(true);
    setError(null);
    try {
      const summary = await updateAttendance(bookingId, attendance);
      toast.success(summary.idempotentReplay ? text.attendanceReplay : text.attendanceSaved);
      await onSaved(summary);
    } catch (caught: unknown) {
      const message =
        caught instanceof ApiError && caught.status === 409
          ? text.attendanceConflict
          : caught instanceof ApiError && caught.status === 403
            ? text.attendanceOwner
            : text.attendanceFailed;
      setError(message);
      toast.error(message);
    } finally {
      gate.current = false;
      setPending(false);
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
          disabled={pending || Boolean(disabledMessage)}
          onClick={() => void save('ATTENDED')}
        >
          {pending ? text.attendanceSaving : text.attended}
        </NotebookAction>
        <NotebookAction
          type="button"
          size="compact"
          tone="secondary"
          disabled={pending || Boolean(disabledMessage)}
          onClick={() => void save('ABSENT')}
        >
          {text.absent}
        </NotebookAction>
      </div>
    </section>
  );
}

import { classDetailsCopy } from '@/components/bookings/class-details-copy';
import { formatBangkokDateTime } from '@/lib/date-time';

import styles from './class-details.module.css';

import type { SavedAttendanceSummary as SavedAttendance } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export function SavedAttendanceSummary({
  attendance,
  language,
}: {
  attendance: Pick<SavedAttendance, 'attendance'> & { attendanceMarkedAt: string | null };
  language: Language;
}) {
  const text = classDetailsCopy[language];
  const value = attendance.attendance === 'ATTENDED' ? text.attended : text.absent;
  return (
    <section className={styles.attendanceSummary} aria-label={text.attendanceTitle}>
      <p className={styles.attendanceLabel}>{text.attendanceTitle}</p>
      <p className={styles.attendanceValue}>{value}</p>
      {attendance.attendanceMarkedAt && (
        <p className={styles.attendanceTimestamp}>
          {text.attendanceRecorded}:{' '}
          <time dateTime={attendance.attendanceMarkedAt}>
            {formatBangkokDateTime(attendance.attendanceMarkedAt, language)}
          </time>
        </p>
      )}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { classDetailsCopy } from '@/components/bookings/class-details-copy';
import { hasClassroomAccess, isSafeMeetingUrl } from '@/components/bookings/class-details-model';
import { MeetingLinkEditor } from '@/components/bookings/meeting-link-editor';
import { tutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import { getStudentLabel } from '@/components/bookings/tutor-booking-inbox-model';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookActionContent, notebookActionClass } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getClassDetails } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useAuth } from '@/lib/auth-context';
import { formatBangkokShortDate, formatBangkokTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './class-details.module.css';

import type { BookingClassDetails, BookingStatus } from '@/lib/api/types';

export function ClassDetailsPanel({
  bookingId,
  status,
  variant = 'full',
}: {
  bookingId: string;
  status?: BookingStatus;
  variant?: 'full' | 'compact';
}) {
  const { user } = useAuth();
  // Remount for a different booking, session, or server-confirmed status. Old reads cannot reveal links.
  return (
    <ClassDetailsContent
      key={`${user?.id}:${bookingId}:${status}`}
      bookingId={bookingId}
      status={status}
      variant={variant}
    />
  );
}

function ClassDetailsContent({
  bookingId,
  status,
  variant,
}: {
  bookingId: string;
  status: BookingStatus | undefined;
  variant: 'full' | 'compact';
}) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const text = classDetailsCopy[language];
  const isTutor = user?.role === 'TUTOR';
  const compact = variant === 'compact';
  const [details, setDetails] = useState<BookingClassDetails | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [uncertain, setUncertain] = useState(false);
  const [saving, setSaving] = useState(false);
  const active = useRef(false);
  const sequence = useRef(0);
  const load = useCallback((): Promise<void> => {
    const request = ++sequence.current;
    return getClassDetails(bookingId)
      .then((result) => {
        if (active.current && request === sequence.current) {
          setDetails(result);
          setUncertain(false);
        }
      })
      .catch((caught: unknown) => {
        if (active.current && request === sequence.current) {
          setError(caught);
        }
      })
      .finally(() => {
        if (active.current && request === sequence.current) {
          setLoading(false);
        }
      });
  }, [bookingId]);

  async function refresh(): Promise<void> {
    setLoading(true);
    setDetails(null);
    setError(null);
    await load();
  }
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      sequence.current += 1;
    };
  }, [load]);
  const errorMessage =
    error instanceof ApiError && error.status === 403
      ? text.forbidden
      : error instanceof ApiError && error.status === 404
        ? text.notFound
        : error instanceof ApiError && error.status === 409
          ? text.hidden
          : text.failed;
  const accessible =
    details &&
    hasClassroomAccess(details.status) &&
    (status === undefined || hasClassroomAccess(status));
  const link =
    accessible && !uncertain && details.meetingUrl && isSafeMeetingUrl(details.meetingUrl)
      ? details.meetingUrl
      : null;

  return (
    <section
      className={`${styles.panel} ${compact ? styles.compact : ''}`}
      aria-label={text.title}
      aria-busy={loading}
    >
      <h2>{text.title}</h2>
      {loading ? (
        <NotebookLoadingRegion label={text.loading} />
      ) : error ? (
        <p role="alert">{errorMessage}</p>
      ) : details ? (
        <>
          {!compact && (
            <>
              <header className={styles.classHeader}>
                <p className={styles.subjectTab}>
                  <span className="sr-only">{text.subject}: </span>
                  {details.subject.name}
                </p>
                <div className={styles.identity}>
                  {isTutor && (
                    <div>
                      <p className={styles.caption}>{text.student}</p>
                      <h3 className={styles.studentName}>
                        {getStudentLabel(
                          { student: { nickname: details.participants.student.detail.nickname } },
                          tutorBookingInboxCopy[language],
                        )}
                      </h3>
                    </div>
                  )}
                  <div className={styles.tutorIdentity}>
                    <p className={styles.caption}>{text.tutor}</p>
                    <p>{details.participants.tutor.detail.displayName}</p>
                  </div>
                </div>
              </header>
              <div className={styles.timeBand}>
                <dl className={styles.schedule}>
                  {[
                    { label: text.start, value: details.startAt },
                    { label: text.end, value: details.endAt },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        <time dateTime={value}>
                          <strong>{formatBangkokTime(value, language)}</strong>
                          <span>{formatBangkokShortDate(value, language)}</span>
                        </time>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.timezone}>{text.timezone}</p>
              </div>
            </>
          )}
          <div
            className={`${styles.workspace} ${!uncertain && isTutor && accessible ? styles.withEditor : ''}`}
          >
            <div className={styles.entry}>
              {!compact && <h3>{text.entry}</h3>}
              {!accessible ? (
                <p className={styles.note}>{text.hidden}</p>
              ) : uncertain ? (
                <p className={styles.note} role="alert">
                  {text.uncertain}
                </p>
              ) : link ? (
                <a
                  className={notebookActionClass({
                    role: isTutor ? 'tutor' : 'student',
                    tone: 'primary',
                    size: 'compact',
                  })}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <NotebookActionContent icon={<DashboardIcon name="arrow-right" />}>
                    {text.join}
                  </NotebookActionContent>
                </a>
              ) : (
                <p className={styles.note}>{details.meetingUrl ? text.invalid : text.missing}</p>
              )}
              {details.status === 'COMPLETED' && <p className={styles.note}>{text.completed}</p>}
            </div>
            {!uncertain && isTutor && accessible && (
              <MeetingLinkEditor
                bookingId={bookingId}
                meetingUrl={details.meetingUrl}
                onSaved={refresh}
                onBusyChange={setSaving}
                onUncertain={(caught) => {
                  setUncertain(true);
                  if (caught instanceof ApiError) {
                    setDetails(null);
                    setError(caught);
                  }
                }}
              />
            )}
          </div>
        </>
      ) : (
        <p>{text.hidden}</p>
      )}
      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.refresh}
          disabled={loading || saving}
          onClick={() => void refresh()}
        >
          {text.refresh}
        </button>
      </footer>
    </section>
  );
}

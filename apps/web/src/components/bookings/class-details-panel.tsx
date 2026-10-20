'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AttendanceForm } from '@/components/bookings/attendance-form';
import { classDetailsCopy } from '@/components/bookings/class-details-copy';
import {
  attendanceEligibility,
  hasClassroomAccess,
  isSafeMeetingUrl,
} from '@/components/bookings/class-details-model';
import { MeetingLinkEditor } from '@/components/bookings/meeting-link-editor';
import { PaymentStatusBadge } from '@/components/bookings/promptpay-payment-panel';
import { SavedAttendanceSummary } from '@/components/bookings/saved-attendance-summary';
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

import type {
  BookingClassDetails,
  BookingStatus,
  PaymentStatus,
  SavedAttendanceSummary as AttendanceSummary,
} from '@/lib/api/types';
import type { RefObject } from 'react';

export function ClassDetailsPanel({
  bookingId,
  status,
  paymentStatus,
  variant = 'full',
  onRefresh,
  refreshDisabled = false,
  restoreRefreshFocusRef,
}: {
  bookingId: string;
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  variant?: 'full' | 'compact';
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  restoreRefreshFocusRef?: RefObject<boolean>;
}) {
  const { user } = useAuth();
  // Remount for a different booking, session, or server-confirmed status. Old reads cannot reveal links.
  return (
    <ClassDetailsContent
      key={`${user?.id}:${user?.role}:${bookingId}:${status}:${paymentStatus}`}
      bookingId={bookingId}
      status={status}
      paymentStatus={paymentStatus}
      variant={variant}
      onRefresh={onRefresh}
      refreshDisabled={refreshDisabled}
      restoreRefreshFocusRef={restoreRefreshFocusRef}
    />
  );
}

function ClassDetailsContent({
  bookingId,
  status,
  paymentStatus,
  variant,
  onRefresh,
  refreshDisabled,
  restoreRefreshFocusRef,
}: {
  bookingId: string;
  status: BookingStatus | undefined;
  paymentStatus: PaymentStatus | undefined;
  variant: 'full' | 'compact';
  onRefresh: (() => void) | undefined;
  refreshDisabled: boolean;
  restoreRefreshFocusRef: RefObject<boolean> | undefined;
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
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceBlocked, setAttendanceBlocked] = useState(false);
  const [now, setNow] = useState(Date.now);
  const active = useRef(false);
  const sequence = useRef(0);
  const refreshButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!loading && restoreRefreshFocusRef?.current) {
      restoreRefreshFocusRef.current = false;
      if (document.activeElement === document.body) {
        refreshButton.current?.focus();
      }
    }
  }, [loading, restoreRefreshFocusRef]);
  const load = useCallback((): Promise<void> => {
    const request = ++sequence.current;
    return getClassDetails(bookingId)
      .then((result) => {
        if (active.current && request === sequence.current) {
          setDetails(result);
          setUncertain(false);
          setAttendanceBlocked(false);
          setNow(Date.now());
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

  useEffect(() => {
    if (
      !details ||
      !isTutor ||
      details.participants.tutor.id !== user?.id ||
      details.status !== 'CONFIRMED' ||
      details.attendance !== null
    ) {
      return;
    }
    const endAt = new Date(details.endAt).getTime();
    if (!Number.isFinite(endAt) || endAt <= now) {
      return;
    }
    // Catch up if the deadline passed after the read's clock snapshot but before this effect.
    const remaining = endAt - Date.now();
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(remaining + 1, 0), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [details, isTutor, now, user?.id]);

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
    hasClassroomAccess(details.status, details.paymentStatus) &&
    (status === undefined || hasClassroomAccess(status, details.paymentStatus)) &&
    paymentStatus !== 'UNPAID';
  const link =
    accessible && !uncertain && details.meetingUrl && isSafeMeetingUrl(details.meetingUrl)
      ? details.meetingUrl
      : null;
  const attendanceState =
    details && isTutor
      ? attendanceEligibility({
          status: details.status,
          paymentStatus: details.paymentStatus,
          endAt: details.endAt,
          isOwner: details.participants.tutor.id === user?.id,
          attendance: details.attendance,
          now,
        })
      : null;
  const attendanceMessage =
    attendanceState === 'owner'
      ? text.attendanceOwner
      : attendanceState === 'unpaid'
        ? text.paymentRequired
        : attendanceState === 'pending'
          ? text.attendancePending
          : attendanceState === 'future'
            ? text.attendanceFuture
            : attendanceState === 'unavailable'
              ? text.attendanceUnavailable
              : attendanceState === 'saved'
                ? text.attendanceReplay
                : null;
  async function handleAttendanceSaved(summary: AttendanceSummary): Promise<void> {
    if (!active.current) {
      return;
    }
    setDetails((current) =>
      current
        ? {
            ...current,
            attendance: summary.attendance,
            attendanceMarkedAt: summary.attendanceMarkedAt,
            status: summary.status,
          }
        : current,
    );
    // The detail read verifies the persisted value; the parent refresh updates its
    // booking-status snapshot after the first attendance transition.
    try {
      await load();
      if (active.current) {
        onRefresh?.();
      }
    } finally {
      if (active.current) {
        setAttendanceBusy(false);
      }
    }
  }

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
          <p>
            <span className="sr-only">{text.paymentStatus}: </span>
            <PaymentStatusBadge status={details.paymentStatus} />
          </p>
          <fieldset
            className={`${styles.workspace} ${!uncertain && isTutor && accessible ? styles.withEditor : ''}`}
            aria-label={text.entry}
            disabled={attendanceBusy}
          >
            <div className={styles.entry}>
              {!compact && <h3>{text.entry}</h3>}
              {!accessible ? (
                <p className={styles.note}>
                  {details.paymentStatus !== 'PAID' ? text.paymentRequired : text.hidden}
                </p>
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
              {accessible && details.status === 'COMPLETED' && (
                <p className={styles.note}>{text.completed}</p>
              )}
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
          </fieldset>
          {isTutor && (
            <div className={styles.attendanceArea}>
              {attendanceState === 'saved' && details.attendance !== null ? (
                <SavedAttendanceSummary
                  attendance={{
                    attendance: details.attendance,
                    attendanceMarkedAt: details.attendanceMarkedAt ?? null,
                  }}
                  language={language}
                />
              ) : (
                <AttendanceForm
                  bookingId={bookingId}
                  onSaved={handleAttendanceSaved}
                  onBusyChange={setAttendanceBusy}
                  onUncertain={() => setAttendanceBlocked(true)}
                  disabled={saving || refreshDisabled}
                  disabledMessage={
                    attendanceBlocked ? text.attendanceRecover : (attendanceMessage ?? undefined)
                  }
                />
              )}
            </div>
          )}
        </>
      ) : (
        <p>{text.hidden}</p>
      )}
      <footer className={styles.footer}>
        <button
          ref={refreshButton}
          type="button"
          className={styles.refresh}
          disabled={loading || saving || attendanceBusy || refreshDisabled}
          onClick={() => {
            if (onRefresh) {
              onRefresh();
              return;
            }
            void refresh();
          }}
        >
          {text.refresh}
        </button>
      </footer>
    </section>
  );
}

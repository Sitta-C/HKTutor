'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { classDetailsCopy } from '@/components/bookings/class-details-copy';
import { hasClassroomAccess, isSafeMeetingUrl } from '@/components/bookings/class-details-model';
import { MeetingLinkEditor } from '@/components/bookings/meeting-link-editor';
import { NotebookAction } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getClassDetails } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useAuth } from '@/lib/auth-context';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './class-details.module.css';

import type { BookingClassDetails, BookingStatus } from '@/lib/api/types';

export function ClassDetailsPanel({
  bookingId,
  status,
}: {
  bookingId: string;
  status?: BookingStatus;
}) {
  const { user } = useAuth();
  // Remount for a different booking, session, or server-confirmed status. Old reads cannot reveal links.
  return (
    <ClassDetailsContent
      key={`${user?.id}:${bookingId}:${status}`}
      bookingId={bookingId}
      status={status}
    />
  );
}

function ClassDetailsContent({
  bookingId,
  status,
}: {
  bookingId: string;
  status: BookingStatus | undefined;
}) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const text = classDetailsCopy[language];
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
    <section className={styles.panel} aria-label={text.title} aria-busy={loading}>
      <h2>{text.title}</h2>
      {loading ? (
        <NotebookLoadingRegion label={text.loading} />
      ) : error ? (
        <p role="alert">{errorMessage}</p>
      ) : details ? (
        <>
          <dl className={styles.details}>
            <div>
              <dt>{text.tutor}</dt>
              <dd>{details.participants.tutor.detail.displayName}</dd>
            </div>
            <div>
              <dt>{text.subject}</dt>
              <dd>{details.subject.name}</dd>
            </div>
            <div>
              <dt>{text.start}</dt>
              <dd>
                <time dateTime={details.startAt}>
                  {formatBangkokDateTime(details.startAt, language)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{text.end}</dt>
              <dd>
                <time dateTime={details.endAt}>
                  {formatBangkokDateTime(details.endAt, language)}
                </time>
              </dd>
            </div>
          </dl>
          <p className={styles.note}>{text.timezone}</p>
          {!accessible ? (
            <p>{text.hidden}</p>
          ) : uncertain ? (
            <p role="alert">{text.uncertain}</p>
          ) : link ? (
            <a className={styles.join} href={link} target="_blank" rel="noopener noreferrer">
              {text.join}
            </a>
          ) : (
            <p>{details.meetingUrl ? text.invalid : text.missing}</p>
          )}
          {details.status === 'COMPLETED' && <p className={styles.note}>{text.completed}</p>}
          {!uncertain && user?.role === 'TUTOR' && accessible && (
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
        </>
      ) : (
        <p>{text.hidden}</p>
      )}
      <NotebookAction
        tone="quiet"
        size="compact"
        disabled={loading || saving}
        onClick={() => void refresh()}
      >
        {text.refresh}
      </NotebookAction>
    </section>
  );
}

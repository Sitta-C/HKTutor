'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { BookingStatusBadge } from '@/components/bookings/booking-ui';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { PaperCard, StickyNote, WashiTape } from '@/components/ui/notebook';
import { NotebookLoading } from '@/components/ui/notebook-loading';
import { NotebookPagination } from '@/components/ui/notebook-pagination';
import { getMyBookings } from '@/lib/api/bookings';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import {
  formatBangkokDateParts,
  formatBangkokDateRange,
  formatBangkokShortDate,
  formatBangkokTime,
  getBangkokIsoDate,
} from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './student-dashboard.module.css';

import type { AuthUser, BookingView } from '@/lib/api/types';
import type { DateTimeLanguage } from '@/lib/date-time';

const TUTORS_PER_PAGE = 4;

export interface StudentDashboardProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export function StudentDashboard({ user, onLogout }: StudentDashboardProps) {
  const { copy, language } = useLanguage();
  const displayName = getUserDisplayName(user);
  const studentCopy = copy.dashboard.student;
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mountedAt] = useState(() => Date.now());
  const [tutorPage, setTutorPage] = useState(1);

  useEffect(() => {
    let active = true;
    getMyBookings({ pageSize: 100 })
      .then((result) => {
        if (!active) return;
        setBookings(result.items);
        setTutorPage(1);
        setLoadError(null);
      })
      .catch(() => {
        if (active) setLoadError(studentCopy.loadError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [studentCopy.loadError]);

  const upcoming = useMemo(
    () =>
      bookings
        .filter(
          (booking) =>
            (booking.status === 'PENDING' || booking.status === 'CONFIRMED') &&
            new Date(booking.slot.startAtUtc).getTime() > mountedAt,
        )
        .sort(
          (left, right) =>
            new Date(left.slot.startAtUtc).getTime() - new Date(right.slot.startAtUtc).getTime(),
        ),
    [bookings, mountedAt],
  );
  const nextBooking = upcoming[0];
  const pendingCount = bookings.filter((booking) => booking.status === 'PENDING').length;
  const completedCount = bookings.filter((booking) => booking.status === 'COMPLETED').length;
  const tutorBookings = useMemo(
    () => Array.from(new Map(bookings.map((booking) => [booking.tutor.tutorId, booking])).values()),
    [bookings],
  );
  const tutorPageCount = Math.max(1, Math.ceil(tutorBookings.length / TUTORS_PER_PAGE));
  const currentTutorPage = Math.min(Math.max(1, tutorPage), tutorPageCount);
  const visibleTutors = tutorBookings.slice(
    (currentTutorPage - 1) * TUTORS_PER_PAGE,
    currentTutorPage * TUTORS_PER_PAGE,
  );

  return (
    <DashboardShell
      user={user}
      onLogout={onLogout}
      headerNavRight={
        <Link href="/tutors" data-dashboard-action>
          {copy.dashboard.header.findTutorCta}
        </Link>
      }
      navBadges={{ bookings: isLoading || loadError ? '—' : String(bookings.length) }}
    >
      <div className={styles.greeting}>
        <p className={styles.eyebrow}>{studentCopy.plannerEyebrow}</p>
        <h1>{copy.dashboard.common.welcomeBack.replace('{name}', displayName)}</h1>
        <p className={styles.intro}>
          {studentCopy.plannerSubtitle} · {copy.dashboard.common.bangkokTimeWithZone}
        </p>
      </div>

      {isLoading ? (
        <NotebookLoading
          kind="studentDashboard"
          label={copy.dashboard.common.loading}
          layout="content"
        />
      ) : loadError ? (
        <PaperCard className={styles.error} role="alert">
          {loadError}
        </PaperCard>
      ) : (
        <div className={styles.spread}>
          <PaperCard className={styles.leaf} aria-labelledby="student-next-booking">
            <p className={styles.pageTab}>{studentCopy.appointmentTab}</p>
            <div className={styles.appointment}>
              <WashiTape className={styles.tape ?? ''} />
              <div className={styles.caption}>
                <h2 id="student-next-booking">{studentCopy.nextBooking}</h2>
                {nextBooking && (
                  <BookingStatusBadge status={nextBooking.status} text={copy.dashboard.booking} />
                )}
              </div>
              {nextBooking ? (
                <>
                  <div className={styles.appointmentDetails}>
                    <AppointmentDate value={nextBooking.slot.startAtUtc} language={language} />
                    <div className={styles.lessonDetails}>
                      <p className={styles.lessonTime}>
                        <time dateTime={nextBooking.slot.startAtUtc}>
                          {formatBangkokTime(nextBooking.slot.startAtUtc, language)}
                        </time>
                        {'–'}
                        <time dateTime={nextBooking.slot.endAtUtc}>
                          {formatBangkokTime(nextBooking.slot.endAtUtc, language)}
                        </time>
                      </p>
                      <h3 className={styles.tutorName}>{nextBooking.tutor.displayName}</h3>
                      <p className={styles.subject}>
                        {nextBooking.listing.subjectName} · {nextBooking.listing.gradeLevelName}
                      </p>
                    </div>
                  </div>
                  {getBangkokIsoDate(nextBooking.slot.startAtUtc) !==
                    getBangkokIsoDate(nextBooking.slot.endAtUtc) && (
                    <p className={styles.scope}>
                      {formatBangkokDateRange(
                        nextBooking.slot.startAtUtc,
                        nextBooking.slot.endAtUtc,
                        language,
                      )}
                    </p>
                  )}
                  <StickyNote
                    tone={nextBooking.status === 'PENDING' ? 'yellow' : 'green'}
                    className={`${styles.memo} ${nextBooking.status === 'CONFIRMED' ? styles.confirmedMemo : ''}`}
                  >
                    <p className={`font-note ${styles.memoHeading}`}>
                      {nextBooking.status === 'PENDING'
                        ? studentCopy.pendingMemoTitle
                        : studentCopy.confirmedMemoTitle}
                    </p>
                    <p>
                      {nextBooking.status === 'PENDING'
                        ? studentCopy.pendingMemoDescription
                        : studentCopy.confirmedMemoDescription}
                    </p>
                  </StickyNote>
                </>
              ) : (
                <div className={styles.empty}>
                  <p className={styles.emptyTitle}>{studentCopy.noUpcomingLessons}</p>
                  <p>{studentCopy.noUpcomingDescription}</p>
                </div>
              )}
            </div>

            <section className={styles.summary} aria-labelledby="student-booking-overview">
              <h2 id="student-booking-overview">{studentCopy.bookingOverview}</h2>
              <p className={styles.scope}>{studentCopy.loadedBookingsScope}</p>
              <dl className={styles.metrics}>
                <div>
                  <dt>{studentCopy.upcomingSummary}</dt>
                  <dd>{upcoming.length}</dd>
                </div>
                <div>
                  <dt>{studentCopy.pendingSummary}</dt>
                  <dd>{pendingCount}</dd>
                </div>
                <div>
                  <dt>{studentCopy.completedSummary}</dt>
                  <dd>{completedCount}</dd>
                </div>
              </dl>
              <p className={styles.scope}>{studentCopy.upcomingIncludesPending}</p>
            </section>
          </PaperCard>

          <div className={styles.binding} aria-hidden="true" data-student-binding />

          <PaperCard className={styles.leaf} aria-labelledby="student-tutor-index">
            <p className={styles.indexTab}>{studentCopy.tutorIndexTab}</p>
            <div className={styles.tutorIndex}>
              <div className={styles.indexHeading}>
                <h2 id="student-tutor-index">{studentCopy.tutorsFromBookings}</h2>
                <span className={styles.count}>{tutorBookings.length}</span>
              </div>
              <p className={styles.indexHelp}>{studentCopy.tutorIndexDescription}</p>
              {tutorBookings.length === 0 ? (
                <div className={styles.empty}>
                  <p className={styles.emptyTitle}>{studentCopy.noTutorsYetTitle}</p>
                  <p>{studentCopy.noTutorsYetDescription}</p>
                </div>
              ) : (
                <ul className={styles.tutorList}>
                  {visibleTutors.map((booking) => (
                    <li key={booking.tutor.tutorId}>
                      <Link
                        href={`/dashboard/bookings/${encodeURIComponent(booking.id)}`}
                        className={styles.tutorLink}
                      >
                        <span className={styles.initial} aria-hidden="true">
                          {booking.tutor.displayName.trim().slice(0, 1).toUpperCase()}
                        </span>
                        <span className={styles.tutorDetails}>
                          <strong>{booking.tutor.displayName}</strong>
                          <span>
                            {booking.listing.subjectName} · {booking.listing.gradeLevelName}
                          </span>
                          <span className={styles.bookingLink}>
                            {copy.dashboard.booking.view}
                            <DashboardIcon name="arrow-right" className="h-3.5 w-3.5" />
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.pagination}>
                <NotebookPagination
                  page={currentTutorPage}
                  total={tutorBookings.length}
                  pageSize={TUTORS_PER_PAGE}
                  label={studentCopy.tutorsPagination}
                  variant="paper-turn"
                  onPageChange={setTutorPage}
                />
                {tutorPageCount > 1 && <p className={styles.scope}>{studentCopy.tutorsScope}</p>}
              </div>
            </div>
          </PaperCard>
        </div>
      )}
    </DashboardShell>
  );
}

export default StudentDashboard;

function AppointmentDate({ value, language }: { value: string; language: DateTimeLanguage }) {
  const { day, month, year } = formatBangkokDateParts(value, language);
  return (
    <time
      className={styles.dateTile}
      dateTime={value}
      aria-label={formatBangkokShortDate(value, language)}
    >
      <span aria-hidden="true">{month}</span>
      <strong aria-hidden="true">{day}</strong>
      <span aria-hidden="true">{year}</span>
    </time>
  );
}

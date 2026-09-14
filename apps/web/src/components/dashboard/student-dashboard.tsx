'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { getMyBookings } from '@/lib/api/bookings';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser, BookingView } from '@/lib/api/types';

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
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    getMyBookings({ pageSize: 100 })
      .then((result) => {
        if (!active) return;
        setBookings(result.items);
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(caught instanceof Error ? caught.message : studentCopy.loadError);
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

  const headerNav = (
    <>
      <Link href="/dashboard/bookings">{copy.dashboard.header.myBookingsNav}</Link>
      <Link href="/tutors" className="dash-cta">
        {copy.dashboard.header.findTutorCta}
      </Link>
    </>
  );

  return (
    <DashboardShell
      user={user}
      onLogout={onLogout}
      headerNavRight={headerNav}
      navBadges={{ bookings: String(bookings.length) }}
    >
      <div className="dash-greeting">
        <p className="dash-eyebrow">{copy.dashboard.common.eyebrow}</p>
        <h1>
          <span>{copy.dashboard.common.welcomeBack.replace('{name}', displayName)}</span>
          <span className="dash-role-chip dash-role-chip-student">
            {copy.dashboard.common.studentChip}
          </span>
        </h1>
        <p>{studentCopy.subtitle}</p>
      </div>

      <section>
        {loadError && (
          <p
            className="mb-5 rounded-xl border border-[#e2b7ae] bg-[#fff4f1] p-4 text-sm text-[#a34334]"
            role="alert"
          >
            {loadError}
          </p>
        )}
        {/* ROW 1: 4 summary cards */}
        <div className="dash-summary dash-summary-student">
          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--student)' }} />
              <span>{studentCopy.nextLesson}</span>
            </h2>
            <p className="text-xs font-bold uppercase tracking-wider text-[#5e5a52]">
              {copy.dashboard.common.bangkokTimeWithZone}
            </p>
            <div className="py-2.5 text-sm text-[#5e5a52]">
              {nextBooking
                ? `${nextBooking.tutor.displayName} · ${formatBangkokDateTime(nextBooking.slot.startAtUtc, language)}`
                : studentCopy.noUpcomingLessons}
            </div>
            {nextBooking && <span className="dash-pill done">{nextBooking.status}</span>}
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--student)' }} />
              <span>{studentCopy.bookings}</span>
            </h2>
            <div className="dash-big">{upcoming.length}</div>
            <p className="dash-sub">{studentCopy.upcomingLessonsCount}</p>
            <div className="mt-2.5 flex flex-col gap-1.5 text-xs text-[#5e5a52]">
              <div className="flex items-center justify-between">
                <span>
                  <b>{completedCount}</b> {studentCopy.completedLessons}
                </span>
                <span className="dash-pill done">{studentCopy.doneBadge}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  <b>{pendingCount}</b> {studentCopy.awaitingConfirmation}
                </span>
                <span className="dash-pill pending">{studentCopy.pendingBadge}</span>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--student)' }} />
              <span>{studentCopy.quickActions}</span>
            </h2>
            <div className="dash-qa dash-qa-student">
              <Link href="/tutors">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="search" />
                </span>
                <span>{studentCopy.findTutorAction}</span>
              </Link>
              <Link href="/dashboard/bookings">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="calendar" />
                </span>
                <span>{studentCopy.myBookingsAction}</span>
              </Link>
              <Link href="/dashboard/profile">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="settings" />
                </span>
                <span>{studentCopy.accountAction}</span>
              </Link>
            </div>
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--student)' }} />
              <span>{studentCopy.waitingOnTutor}</span>
            </h2>
            <div className="py-4 text-center text-xs text-[#8a857b]">
              {pendingCount > 0
                ? `${pendingCount} ${studentCopy.awaitingConfirmation}`
                : studentCopy.noWaitingRequests}
            </div>
          </div>
        </div>

        {/* ROW 2: Your tutors panel */}
        <div className="dash-card tutors-panel p-6 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <span>{studentCopy.yourTutors}</span>
              <span
                className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-extrabold"
                style={{
                  background: 'var(--student-soft)',
                  color: 'var(--student-deep)',
                }}
              >
                {tutorBookings.length}
              </span>
            </h2>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3 sm:flex-initial">
              <label className="dash-search dash-search-student">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  className="shrink-0 text-[#8a857b]"
                >
                  <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="m14.5 14.5 3 3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  type="search"
                  placeholder={studentCopy.searchPlaceholder}
                  aria-label={studentCopy.searchPlaceholder}
                  disabled
                />
              </label>
              <Link href="/tutors" className="dash-btn-dark">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="plus" />
                </span>
                <span>{studentCopy.findNewTutor}</span>
              </Link>
            </div>
          </div>

          {tutorBookings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#ebe6dd] bg-[#faf8f4] p-8 text-center">
              <p className="text-base font-bold text-[#1a1916]">{studentCopy.noTutorsYetTitle}</p>
              <p className="mt-1 text-xs text-[#5e5a52]">{studentCopy.noTutorsYetDescription}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {tutorBookings.map((booking) => (
                <Link
                  key={booking.tutor.tutorId}
                  href={`/dashboard/bookings/${encodeURIComponent(booking.id)}`}
                  className="rounded-2xl border border-[#ebe6dd] bg-[#faf8f4] p-4"
                >
                  <strong className="block text-sm text-[#1a1916]">
                    {booking.tutor.displayName}
                  </strong>
                  <span className="mt-1 block text-xs text-[#5e5a52]">
                    {booking.listing.subjectName} · {booking.listing.gradeLevelName}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {/* Browse all tutors prompt */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[#ebe6dd] pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0a04e] font-black text-white shadow-sm">
                <DashboardIcon name="plus" className="h-5 w-5" />
              </div>
              <div>
                <b className="block text-sm font-bold text-[#1a1916]">
                  {studentCopy.cantFindTutor}
                </b>
                <span className="text-xs text-[#5e5a52]">{studentCopy.cantFindTutorSub}</span>
              </div>
            </div>
            <Link href="/tutors" className="dash-btn-dark">
              <span>{studentCopy.browseAllTutors}</span>
            </Link>
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}

export default StudentDashboard;

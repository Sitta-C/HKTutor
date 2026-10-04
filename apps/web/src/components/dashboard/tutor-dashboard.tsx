'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { formatDuration } from '@/components/bookings/booking-ui';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { TutorDashboardAnalytics } from '@/components/dashboard/tutor-dashboard-analytics';
import { loadTutorDashboardBookings } from '@/components/dashboard/tutor-dashboard-data';
import {
  getTutorDashboardSummary,
  isPastTutorRequest,
  paginateDashboardItems,
  TUTOR_DASHBOARD_PAGE_SIZE,
} from '@/components/dashboard/tutor-dashboard-model';
import { ArrowIcon } from '@/components/public/public-ui';
import { BookmarkNoteSwitch } from '@/components/ui/bookmark-note-switch';
import { PaperCard, StatusBadge, WashiTape, notebookArchiveClass } from '@/components/ui/notebook';
import { NotebookPagination } from '@/components/ui/notebook-pagination';
import { getTutorAvailability } from '@/lib/api/availability';
import { getTutorListings } from '@/lib/api/listings';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import {
  BANGKOK_TIME_ZONE,
  formatBangkokShortDate,
  formatBangkokTime,
  getBangkokToday,
  getCalendarLocale,
} from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import type {
  AuthUser,
  TeachingListing,
  TutorAvailabilitySlot,
  TutorBookingView,
} from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export interface TutorDashboardProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

const panelClass = 'min-w-0 !rounded-2xl p-5 !shadow-none sm:p-6';
const textLinkClass =
  'inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-tutor-deep underline decoration-tutor-deep/30 underline-offset-4 transition-colors hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep/40 focus-visible:ring-offset-2';

export function TutorDashboard({ user, onLogout }: TutorDashboardProps) {
  const { copy, language } = useLanguage();
  const displayName = getUserDisplayName(user);
  const tutorCopy = copy.dashboard.tutor;
  const [bookings, setBookings] = useState<TutorBookingView[]>([]);
  const [listings, setListings] = useState<TeachingListing[]>([]);
  const [slots, setSlots] = useState<TutorAvailabilitySlot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mountedAt] = useState(() => Date.now());
  const [showPastRequests, setShowPastRequests] = useState(false);
  const [requestPage, setRequestPage] = useState(1);

  useEffect(() => {
    let active = true;
    const today = getBangkokToday();
    const from = bangkokDayBoundary(today);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    Promise.all([
      loadTutorDashboardBookings(),
      getTutorListings(),
      getTutorAvailability({ from, to }),
    ])
      .then(([bookingResult, listingResult, slotResult]) => {
        if (!active) return;
        setBookings(bookingResult);
        setListings(listingResult);
        setSlots(slotResult);
        setLoadError(null);
      })
      .catch(() => {
        if (active) setLoadError(tutorCopy.loadError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tutorCopy.loadError]);

  const { pendingBookings, nextBooking, todaySlots } = useMemo(
    () => getTutorDashboardSummary(bookings, listings, slots, mountedAt),
    [bookings, listings, slots, mountedAt],
  );
  const pastRequestCount = pendingBookings.filter((booking) =>
    isPastTutorRequest(booking, mountedAt),
  ).length;
  const visiblePendingBookings = showPastRequests
    ? pendingBookings
    : pendingBookings.filter((booking) => !isPastTutorRequest(booking, mountedAt));

  const requests = paginateDashboardItems(visiblePendingBookings, requestPage);

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <div className="mb-7 mt-7 sm:mb-8 sm:mt-9">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-tutor-deep">
          {tutorCopy.eyebrow}
        </p>
        <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-notebook-ink sm:text-3xl">
          {copy.dashboard.common.welcomeBack.replace('{name}', displayName)}
        </h1>
        <p className="mt-3 text-sm leading-6 text-notebook-muted">
          {tutorCopy.subtitle} · {formatBangkokShortDate(new Date(mountedAt), language)} ·{' '}
          {copy.dashboard.common.bangkokTimeWithZone}
        </p>
      </div>

      {isLoading ? (
        <PaperCard className={`${panelClass} !bg-white py-12 text-center`} role="status">
          <p className="text-sm text-notebook-muted">{copy.dashboard.common.loading}</p>
        </PaperCard>
      ) : loadError ? (
        <PaperCard className={`${panelClass} !bg-sticky-pink/50`} role="alert">
          <p className="text-sm text-red-800">{loadError}</p>
        </PaperCard>
      ) : (
        <>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
            <PaperCard
              className={`${panelClass} relative self-stretch !bg-sticky-blue/45`}
              aria-labelledby="tutor-next-session"
            >
              <WashiTape tone="yellow" className="left-6 top-0 h-4 w-20 -translate-y-1/2" />
              <div className="flex flex-wrap items-center gap-3">
                <h2
                  id="tutor-next-session"
                  className="flex items-center gap-2 text-sm font-bold text-tutor-deep"
                >
                  <DashboardIcon name="calendar" className="h-4 w-4" />
                  {tutorCopy.nextSession}
                </h2>
                {nextBooking && (
                  <StatusBadge tone="success">{copy.dashboard.booking.confirmed}</StatusBadge>
                )}
              </div>
              {nextBooking ? (
                <>
                  <div className="mt-6 flex items-start gap-4 sm:gap-5">
                    <SessionDate value={nextBooking.slot.startAtUtc} language={language} />
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-xl font-bold text-notebook-ink sm:text-2xl">
                        {nextBooking.student.nickname ?? tutorCopy.unavailableStudent}
                      </h3>
                      <p className="mt-1.5 text-sm leading-6 text-notebook-muted">
                        {nextBooking.listing.subjectName} · {nextBooking.listing.gradeLevelName}
                      </p>
                      <p className="mt-3 text-lg font-semibold tabular-nums text-notebook-ink">
                        {formatBangkokTime(nextBooking.slot.startAtUtc, language)}–
                        {formatBangkokTime(nextBooking.slot.endAtUtc, language)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-6 border-t border-tutor-deep/15 pt-4 text-sm text-notebook-muted">
                    {formatDuration(
                      nextBooking.slot.startAtUtc,
                      nextBooking.slot.endAtUtc,
                      copy.dashboard.booking,
                    )}
                    {' · '}
                    {formatBookingAmount(nextBooking, language)}
                  </p>
                </>
              ) : (
                <p className="py-12 text-base font-semibold leading-7 text-notebook-muted">
                  {tutorCopy.noUpcomingSessions}
                </p>
              )}
            </PaperCard>

            <PaperCard
              className={`${panelClass} !bg-white self-stretch`}
              aria-labelledby="tutor-today-availability"
            >
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-paper-edge pb-4">
                <h2 id="tutor-today-availability" className="text-base font-bold text-notebook-ink">
                  {tutorCopy.todayBangkokTime}
                </h2>
                <DashboardIcon
                  name="availability"
                  className="h-4 w-4 shrink-0 text-notebook-muted"
                />
              </div>
              {todaySlots.length === 0 ? (
                <p className="py-6 text-sm leading-6 text-notebook-muted">
                  {tutorCopy.noSlotsToday}
                </p>
              ) : (
                <ul className="divide-y divide-dashed divide-paper-edge">
                  {todaySlots.map((slot) => (
                    <li
                      key={slot.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3.5"
                    >
                      <span className="text-sm font-medium tabular-nums text-notebook-ink">
                        {formatBangkokTime(slot.startAtUtc, language)}–
                        {formatBangkokTime(slot.endAtUtc, language)}
                      </span>
                      <StatusBadge tone={slot.state === 'OPEN' ? 'tutor' : 'neutral'}>
                        {slot.state === 'OPEN'
                          ? copy.dashboard.availability.open
                          : copy.dashboard.availability.reserved}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/dashboard/availability" className={`${textLinkClass} mt-1`}>
                {tutorCopy.manageAvailability}
                <ArrowIcon />
              </Link>
            </PaperCard>

            <PaperCard
              className={`${panelClass} !bg-white xl:col-span-2`}
              aria-labelledby="tutor-booking-requests"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-edge pb-4">
                <h2
                  id="tutor-booking-requests"
                  className="flex items-center gap-2.5 text-base font-bold text-notebook-ink"
                >
                  {tutorCopy.bookingRequests}
                  <span
                    className="rounded-full bg-sticky-blue/65 px-2.5 py-0.5 text-xs tabular-nums text-tutor-deep"
                    aria-live="polite"
                  >
                    {visiblePendingBookings.length}
                  </span>
                </h2>
                <p className="text-xs text-notebook-muted">{tutorCopy.sortedByLesson}</p>
              </div>
              {pastRequestCount > 0 && (
                <BookmarkNoteSwitch
                  checked={showPastRequests}
                  onCheckedChange={(checked) => {
                    setShowPastRequests(checked);
                    setRequestPage(1);
                  }}
                  aria-controls="tutor-request-list"
                  aria-label={tutorCopy.showPastRequests}
                  className="mt-4"
                >
                  {tutorCopy.showPastRequests}{' '}
                  <span className="text-notebook-muted">({pastRequestCount})</span>
                </BookmarkNoteSwitch>
              )}
              <div id="tutor-request-list">
                {visiblePendingBookings.length === 0 ? (
                  <p className="py-10 text-center text-sm leading-6 text-notebook-muted">
                    {pendingBookings.length === 0
                      ? tutorCopy.noBookingRequestsYet
                      : tutorCopy.noCurrentBookingRequests}
                  </p>
                ) : (
                  <ul className="divide-y divide-paper-edge">
                    {requests.items.map((booking) => {
                      const studentName = booking.student.nickname ?? tutorCopy.unavailableStudent;
                      const isPast = isPastTutorRequest(booking, mountedAt);
                      return (
                        <li
                          key={booking.id}
                          className={`flex items-start gap-3 sm:gap-4 ${isPast ? notebookArchiveClass('my-4') : 'py-5 last:pb-1'}`}
                        >
                          <span
                            className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${isPast ? 'bg-sticky-blue/65 text-tutor-deep' : 'bg-paper-deep text-notebook-muted'}`}
                            aria-hidden="true"
                          >
                            {studentName.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3 className="break-words text-sm font-bold text-notebook-ink">
                              {studentName}
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-notebook-muted">
                              {booking.listing.subjectName} · {booking.listing.gradeLevelName}
                            </p>
                            <p className="mt-1 text-sm font-medium leading-6 tabular-nums text-notebook-ink">
                              <time dateTime={booking.slot.startAtUtc}>
                                {formatBangkokShortDate(booking.slot.startAtUtc, language)}
                              </time>
                              {' · '}
                              {formatBangkokTime(booking.slot.startAtUtc, language)}–
                              {formatBangkokTime(booking.slot.endAtUtc, language)}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-notebook-muted">
                              <StatusBadge tone={isPast ? 'neutral' : 'warning'}>
                                {copy.dashboard.booking.pending}
                              </StatusBadge>
                              {isPast && (
                                <span className="inline-flex items-center gap-1.5 font-medium text-tutor-deep">
                                  <span
                                    aria-hidden="true"
                                    className="h-1.5 w-1.5 rounded-full border border-current"
                                  />
                                  {tutorCopy.pastLesson}
                                </span>
                              )}
                              <span>{formatBookingAmount(booking, language)}</span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <NotebookPagination
                page={requests.page}
                total={visiblePendingBookings.length}
                pageSize={TUTOR_DASHBOARD_PAGE_SIZE}
                label={tutorCopy.requestsPagination}
                onPageChange={setRequestPage}
              />
            </PaperCard>
          </div>
          <TutorDashboardAnalytics bookings={bookings} listings={listings} now={mountedAt} />
        </>
      )}
    </DashboardShell>
  );
}

export default TutorDashboard;

function bangkokDayBoundary(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

function SessionDate({ value, language }: { value: string; language: Language }) {
  const date = new Date(value);
  const locale = getCalendarLocale(language);
  const parts = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: BANGKOK_TIME_ZONE }).format(date);
  return (
    <time
      dateTime={value}
      className="flex min-w-16 shrink-0 flex-col items-center rounded-xl bg-white px-3 py-2.5 text-tutor-deep"
    >
      <span className="text-xs">{parts({ month: 'short' })}</span>
      <span className="my-1 text-3xl font-bold leading-none tabular-nums">
        {parts({ day: 'numeric' })}
      </span>
      <span className="text-xs tabular-nums">{parts({ year: 'numeric' })}</span>
    </time>
  );
}

function formatBookingAmount(booking: TutorBookingView, language: Language): string {
  return new Intl.NumberFormat(getCalendarLocale(language), {
    style: 'currency',
    currency: booking.currency,
  }).format(Number(booking.netAmount));
}

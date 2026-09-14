'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { getTutorAvailability } from '@/lib/api/availability';
import { getTutorBookings } from '@/lib/api/bookings';
import { getTutorListings } from '@/lib/api/listings';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import { formatBangkokDateTime, getBangkokToday } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import type {
  AuthUser,
  TeachingListing,
  TutorAvailabilitySlot,
  TutorBookingView,
} from '@/lib/api/types';

export interface TutorDashboardProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export function TutorDashboard({ user, onLogout }: TutorDashboardProps) {
  const { copy, language } = useLanguage();
  const displayName = getUserDisplayName(user);
  const tutorCopy = copy.dashboard.tutor;
  const [bookings, setBookings] = useState<TutorBookingView[]>([]);
  const [listings, setListings] = useState<TeachingListing[]>([]);
  const [slots, setSlots] = useState<TutorAvailabilitySlot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const today = getBangkokToday();
    const from = bangkokDayBoundary(today);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    Promise.all([
      getTutorBookings({ pageSize: 100 }),
      getTutorListings(),
      getTutorAvailability({ from, to }),
    ])
      .then(([bookingResult, listingResult, slotResult]) => {
        if (!active) return;
        setBookings(bookingResult.items);
        setListings(listingResult);
        setSlots(slotResult);
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(caught instanceof Error ? caught.message : tutorCopy.loadError);
      });
    return () => {
      active = false;
    };
  }, [tutorCopy.loadError]);

  const pendingBookings = bookings.filter((booking) => booking.status === 'PENDING');
  const upcomingBookings = useMemo(
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
  const nextBooking = upcomingBookings[0];
  const publishedListings = listings.filter((listing) => listing.publicationStatus === 'PUBLISHED');

  const headerNav = (
    <>
      <Link href="/dashboard/listings">{copy.dashboard.header.myListingsNav}</Link>
      <Link href="/dashboard/listings/new" className="dash-cta">
        {copy.dashboard.header.newListingCta}
      </Link>
    </>
  );

  return (
    <DashboardShell user={user} onLogout={onLogout} headerNavRight={headerNav}>
      <div className="dash-greeting">
        <p className="dash-eyebrow">{copy.dashboard.common.eyebrow}</p>
        <h1>
          <span>{copy.dashboard.common.welcomeBack.replace('{name}', displayName)}</span>
          <span className="dash-role-chip dash-role-chip-tutor">
            {copy.dashboard.common.tutorChip}
          </span>
        </h1>
        <p>{tutorCopy.subtitle}</p>
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
        <div className="dash-summary dash-summary-tutor">
          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--tutor)' }} />
              <span>{tutorCopy.nextSession}</span>
            </h2>
            <p className="text-xs font-bold uppercase tracking-wider text-[#5e5a52]">
              {copy.dashboard.common.bangkokTimeWithZone}
            </p>
            <div className="py-2.5 text-sm text-[#5e5a52]">
              {nextBooking
                ? `${nextBooking.student.nickname ?? tutorCopy.unavailableStudent} · ${formatBangkokDateTime(nextBooking.slot.startAtUtc, language)}`
                : tutorCopy.noUpcomingSessions}
            </div>
            {nextBooking && <span className="dash-pill done">{nextBooking.status}</span>}
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--tutor)' }} />
              <span>{tutorCopy.requests}</span>
            </h2>
            <div className="dash-big">{pendingBookings.length}</div>
            <p className="dash-sub">{tutorCopy.awaitingYourReply}</p>
            <div className="mt-2.5 flex flex-col gap-1.5 text-xs text-[#5e5a52]">
              <div className="flex items-center justify-between">
                <span>
                  <b>{pendingBookings.length}</b> {tutorCopy.thisWeekCount}
                </span>
                <span className="dash-pill pending">{tutorCopy.pendingBadge}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  <b>0</b> {tutorCopy.rescheduleCount}
                </span>
                <span className="dash-pill pending">{tutorCopy.reviewBadge}</span>
              </div>
            </div>
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--tutor)' }} />
              <span>{tutorCopy.earnings}</span>
            </h2>
            <div className="dash-earnings-value">
              <strong>0฿</strong>
              <span>{tutorCopy.thisMonth}</span>
            </div>
            <div className="mt-2.5 flex flex-col gap-1.5 text-xs text-[#5e5a52]">
              <div className="flex items-center justify-between">
                <span>{tutorCopy.sessionsDoneZero}</span>
                <span className="dash-pill done">{tutorCopy.paidBadge}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{tutorCopy.profileStrength}</span>
                <b>0%</b>
              </div>
            </div>
            <div className="dash-strength" aria-hidden="true">
              <i style={{ width: '0%' }} />
            </div>
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--tutor)' }} />
              <span>{tutorCopy.quickActions}</span>
            </h2>
            <div className="dash-qa dash-qa-tutor">
              <Link href="/dashboard/listings/new">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="plus" />
                </span>
                <span>{tutorCopy.newListingAction}</span>
              </Link>
              <Link href="/dashboard/availability">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="calendar" />
                </span>
                <span>{tutorCopy.openSlotsAction}</span>
              </Link>
              <Link href="/dashboard/profile">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="profile" />
                </span>
                <span>{tutorCopy.editProfileAction}</span>
              </Link>
            </div>
          </div>
        </div>

        {/* ROW 2: Booking requests panel */}
        <div className="dash-card tutors-panel p-6 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <span>{tutorCopy.bookingRequests}</span>
              <span
                className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-extrabold"
                style={{
                  background: 'var(--tutor-soft)',
                  color: 'var(--tutor-deep)',
                }}
              >
                {pendingBookings.length}
              </span>
            </h2>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-3 sm:flex-initial">
              <label className="dash-search dash-search-tutor">
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
                  placeholder={tutorCopy.searchPlaceholder}
                  aria-label={tutorCopy.searchPlaceholder}
                  disabled
                />
              </label>
              <Link href="/dashboard/availability" className="dash-btn-dark">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="calendar" />
                </span>
                <span>{tutorCopy.openCalendar}</span>
              </Link>
            </div>
          </div>

          {pendingBookings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#ebe6dd] bg-[#faf8f4] p-8 text-center">
              <p className="text-base font-bold text-[#1a1916]">{tutorCopy.noBookingRequestsYet}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-2xl border border-[#ebe6dd] bg-[#faf8f4] p-4"
                >
                  <strong>{booking.student.nickname ?? tutorCopy.unavailableStudent}</strong>
                  <p className="mt-1 text-sm text-[#5e5a52]">
                    {booking.listing.subjectName} · {booking.listing.gradeLevelName} ·{' '}
                    {formatBangkokDateTime(booking.slot.startAtUtc, language)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ROW 3: My listings panel */}
        <div className="dash-card tutors-panel mt-5 p-6 sm:p-7">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
              <span>{tutorCopy.myListings}</span>
              <span
                className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-extrabold"
                style={{
                  background: 'var(--tutor-soft)',
                  color: 'var(--tutor-deep)',
                }}
              >
                {listings.length}
              </span>
            </h2>
            <Link href="/dashboard/listings/new" className="dash-btn-dark">
              <span className="ico" aria-hidden="true">
                <DashboardIcon name="plus" />
              </span>
              <span>{tutorCopy.newListingAction}</span>
            </Link>
          </div>

          {listings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#ebe6dd] bg-[#faf8f4] p-8 text-center">
              <p className="text-base font-bold text-[#1a1916]">{tutorCopy.noListingsYetTitle}</p>
              <p className="mt-1 text-xs text-[#5e5a52]">{tutorCopy.noListingsYetDescription}</p>
            </div>
          ) : (
            <p className="rounded-xl bg-[#f4f7fb] p-5 text-sm text-[#5e5a52]">
              {publishedListings.length} {tutorCopy.publishedBadge} ·{' '}
              {listings.length - publishedListings.length} {tutorCopy.draftBadge}
            </p>
          )}
        </div>

        {/* ROW 4: Today Bangkok time availability panel */}
        <div className="dash-card tutors-panel mt-5 p-6 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-2xl font-extrabold tracking-tight">{tutorCopy.todayBangkokTime}</h2>
            <Link href="/dashboard/availability" className="dash-link !mt-0">
              {tutorCopy.manageAvailability}
            </Link>
          </div>

          <div className="rounded-xl bg-[#f4f7fb] p-6 text-center text-sm text-[#5e5a52]">
            {slots.length > 0 ? `${slots.length} ${tutorCopy.slotsToday}` : tutorCopy.noSlotsToday}
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}

export default TutorDashboard;

function bangkokDayBoundary(date: string): Date {
  return new Date(`${date}T00:00:00+07:00`);
}

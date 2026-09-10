'use client';

import Link from 'next/link';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';

export interface TutorDashboardProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export function TutorDashboard({ user, onLogout }: TutorDashboardProps) {
  const { copy } = useLanguage();
  const displayName = getUserDisplayName(user);
  const tutorCopy = copy.dashboard.tutor;

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
            <div className="py-2.5 text-sm text-[#5e5a52]">{tutorCopy.noUpcomingSessions}</div>
            <span className="dash-pill done">{copy.dashboard.common.comingSoonBadge}</span>
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--tutor)' }} />
              <span>{tutorCopy.requests}</span>
            </h2>
            <div className="dash-big">0</div>
            <p className="dash-sub">{tutorCopy.awaitingYourReply}</p>
            <div className="mt-2.5 flex flex-col gap-1.5 text-xs text-[#5e5a52]">
              <div className="flex items-center justify-between">
                <span>
                  <b>0</b> {tutorCopy.thisWeekCount}
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
              <Link href="#availability">
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
                0
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
              <Link href="#calendar" className="dash-btn-dark">
                <span className="ico" aria-hidden="true">
                  <DashboardIcon name="calendar" />
                </span>
                <span>{tutorCopy.openCalendar}</span>
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-[#ebe6dd] bg-[#faf8f4] p-8 text-center">
            <p className="text-base font-bold text-[#1a1916]">{tutorCopy.noBookingRequestsYet}</p>
            <div className="mx-auto mt-3 max-w-md rounded-xl border border-[#f1ddc4] bg-[#fffaf4] p-3 text-xs text-[#c07a2e]">
              <span className="mr-1.5 inline-flex align-middle" aria-hidden="true">
                <DashboardIcon name="info" className="h-4 w-4" />
              </span>
              <span>{copy.dashboard.common.domainApiNotice}</span>
            </div>
          </div>
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
                0
              </span>
            </h2>
            <Link href="/dashboard/listings/new" className="dash-btn-dark">
              <span className="ico" aria-hidden="true">
                <DashboardIcon name="plus" />
              </span>
              <span>{tutorCopy.newListingAction}</span>
            </Link>
          </div>

          <div className="rounded-2xl border border-dashed border-[#ebe6dd] bg-[#faf8f4] p-8 text-center">
            <p className="text-base font-bold text-[#1a1916]">{tutorCopy.noListingsYetTitle}</p>
            <p className="mt-1 text-xs text-[#5e5a52]">{tutorCopy.noListingsYetDescription}</p>
          </div>
        </div>

        {/* ROW 4: Today Bangkok time availability panel */}
        <div className="dash-card tutors-panel mt-5 p-6 sm:p-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-2xl font-extrabold tracking-tight">{tutorCopy.todayBangkokTime}</h2>
            <Link href="#availability" className="dash-link !mt-0">
              {tutorCopy.manageAvailability}
            </Link>
          </div>

          <div className="rounded-xl bg-[#f4f7fb] p-6 text-center text-sm text-[#5e5a52]">
            {tutorCopy.noSlotsToday}
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}

export default TutorDashboard;

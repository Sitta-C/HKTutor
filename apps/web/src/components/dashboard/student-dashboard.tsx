'use client';

import Link from 'next/link';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';

export interface StudentDashboardProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export function StudentDashboard({ user, onLogout }: StudentDashboardProps) {
  const { copy } = useLanguage();
  const displayName = getUserDisplayName(user);
  const studentCopy = copy.dashboard.student;

  const headerNav = (
    <>
      <Link href="#bookings">{copy.dashboard.header.myBookingsNav}</Link>
      <Link href="#find-tutor" className="dash-cta">
        {copy.dashboard.header.findTutorCta}
      </Link>
    </>
  );

  return (
    <DashboardShell user={user} onLogout={onLogout} headerNavRight={headerNav}>
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
            <div className="py-2.5 text-sm text-[#5e5a52]">{studentCopy.noUpcomingLessons}</div>
            <span className="dash-pill done">{copy.dashboard.common.comingSoonBadge}</span>
          </div>

          <div className="dash-card">
            <h2>
              <span className="dot" style={{ backgroundColor: 'var(--student)' }} />
              <span>{studentCopy.bookings}</span>
            </h2>
            <div className="dash-big">0</div>
            <p className="dash-sub">{studentCopy.upcomingLessonsCount}</p>
            <div className="mt-2.5 flex flex-col gap-1.5 text-xs text-[#5e5a52]">
              <div className="flex items-center justify-between">
                <span>
                  <b>0</b> {studentCopy.completedLessons}
                </span>
                <span className="dash-pill done">{studentCopy.doneBadge}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>
                  <b>0</b> {studentCopy.awaitingConfirmation}
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
              <Link href="#find-tutor">
                <span className="ico" aria-hidden="true">
                  🔍
                </span>
                <span>{studentCopy.findTutorAction}</span>
              </Link>
              <Link href="#bookings">
                <span className="ico" aria-hidden="true">
                  📅
                </span>
                <span>{studentCopy.myBookingsAction}</span>
              </Link>
              <Link href="/dashboard/profile">
                <span className="ico" aria-hidden="true">
                  ⚙️
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
              {studentCopy.noWaitingRequests}
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
                0
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
              <Link href="#find-tutor" className="dash-btn-dark">
                <span className="ico">＋</span>
                <span>{studentCopy.findNewTutor}</span>
              </Link>
            </div>
          </div>

          {/* Honest empty state */}
          <div className="rounded-2xl border border-dashed border-[#ebe6dd] bg-[#faf8f4] p-8 text-center">
            <p className="text-base font-bold text-[#1a1916]">{studentCopy.noTutorsYetTitle}</p>
            <p className="mt-1 text-xs text-[#5e5a52]">{studentCopy.noTutorsYetDescription}</p>
            <div className="mx-auto mt-4 max-w-md rounded-xl border border-[#f1ddc4] bg-[#fffaf4] p-3 text-xs text-[#c07a2e]">
              <span className="mr-1.5 font-bold">ℹ️</span>
              <span>{copy.dashboard.common.domainApiNotice}</span>
            </div>
          </div>

          {/* Browse all tutors prompt */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[#ebe6dd] pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#ffc57d] to-[#f0a04e] font-black text-white shadow-sm">
                ＋
              </div>
              <div>
                <b className="block text-sm font-bold text-[#1a1916]">
                  {studentCopy.cantFindTutor}
                </b>
                <span className="text-xs text-[#5e5a52]">{studentCopy.cantFindTutorSub}</span>
              </div>
            </div>
            <Link href="#find-tutor" className="dash-btn-dark">
              <span>{studentCopy.browseAllTutors}</span>
            </Link>
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}

export default StudentDashboard;

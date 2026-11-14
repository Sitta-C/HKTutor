'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import {
  getTutorDashboardMonthQuery,
  loadTutorDashboardBookings,
} from '@/components/dashboard/tutor-dashboard-data';
import {
  getTutorMonthOverview,
  groupTutorCoursesBySubject,
} from '@/components/dashboard/tutor-dashboard-model';
import { MonthRuler } from '@/components/date-time/month-ruler';
import { ArrowIcon } from '@/components/public/public-ui';
import { PaperCard, notebookButtonClass } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { NotebookMetadata } from '@/components/ui/notebook-metadata';
import { SubjectCourseIndex } from '@/components/ui/subject-course-index';
import { formatCalendarMonth, getBangkokToday, getCalendarLocale } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './tutor-dashboard-analytics.module.css';

import type { TutorBookingAmount } from '@/components/dashboard/tutor-dashboard-model';
import type { TeachingListing, TutorBookingView } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export interface TutorDashboardInsights {
  receivedRevenue?: { month: string; amounts: TutorBookingAmount[] };
  reviews?: { average: number | null; count: number };
}

const panelClass = 'min-w-0 !rounded-2xl !bg-white p-5 !shadow-none sm:p-6';

function formatAmounts(amounts: TutorBookingAmount[], language: Language): string[] {
  if (amounts.length === 0) {
    return [
      new Intl.NumberFormat(getCalendarLocale(language), {
        style: 'currency',
        currency: 'THB',
      }).format(0),
    ];
  }
  return amounts.map(({ currency, minorUnits }) =>
    new Intl.NumberFormat(getCalendarLocale(language), { style: 'currency', currency }).format(
      minorUnits / 100,
    ),
  );
}

export function TutorDashboardAnalytics({
  listings,
  now,
  insights,
}: {
  listings: TeachingListing[];
  now: number;
  insights?: TutorDashboardInsights;
}) {
  const { copy, language } = useLanguage();
  const text = copy.dashboard.tutor;
  const [month, setMonth] = useState(() => getBangkokToday(new Date(now)).slice(0, 7));
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<{
    month: string;
    refreshKey: number;
    bookings: TutorBookingView[];
    failed: boolean;
  } | null>(null);
  const currentResult = result?.month === month && result.refreshKey === refreshKey ? result : null;
  const isLoading = currentResult === null;
  const loadError = currentResult?.failed ?? false;
  const hasData = !isLoading && !loadError;

  useEffect(() => {
    let active = true;
    loadTutorDashboardBookings(getTutorDashboardMonthQuery(month))
      .then((items) => {
        if (active) setResult({ month, refreshKey, bookings: items, failed: false });
      })
      .catch(() => {
        if (active) setResult({ month, refreshKey, bookings: [], failed: true });
      });
    return () => {
      active = false;
    };
  }, [month, refreshKey]);
  const summary = useMemo(
    () =>
      getTutorMonthOverview(
        currentResult?.failed === false ? currentResult.bookings : [],
        listings,
        month,
      ),
    [currentResult, listings, month],
  );
  const selectedCourse = summary.courses.find((course) => course.listing.id === selectedCourseId);
  const subjectGroups = groupTutorCoursesBySubject(summary.courses);
  const number = (value: number) =>
    new Intl.NumberFormat(getCalendarLocale(language), { maximumFractionDigits: 1 }).format(value);
  const monthLabel = formatCalendarMonth(`${month}-01`, language);
  const receivedRevenue =
    insights?.receivedRevenue?.month === month ? insights.receivedRevenue.amounts : undefined;
  const maximumMinutes = Math.max(...summary.weeks.map((week) => week.minutes));

  return (
    <section aria-labelledby="tutor-analytics" className={styles.analytics}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="tutor-analytics" className="text-xl font-bold text-notebook-ink">
            {text.analyticsTitle}
          </h2>
          <p className="mt-1 text-sm leading-6 text-notebook-muted">{text.analyticsDescription}</p>
        </div>
        <MonthRuler
          value={month}
          language={language}
          label={text.selectedMonth}
          hint={text.monthRulerHint}
          selectedLabel={text.selectedMonthLabel}
          onChange={setMonth}
        />
      </div>

      {isLoading && <NotebookLoadingRegion label={text.analyticsLoading} />}
      {loadError && (
        <PaperCard className={`${panelClass} !bg-sticky-pink/50`} role="alert">
          <p className="text-sm text-red-800">{text.analyticsLoadError}</p>
          <button
            type="button"
            className={notebookButtonClass({ tone: 'secondary', className: 'mt-4' })}
            onClick={() => setRefreshKey((key) => key + 1)}
          >
            {text.retry}
          </button>
        </PaperCard>
      )}

      <div className={styles.monthSheet}>
        <dl className={styles.metrics} aria-busy={isLoading}>
          {[
            { label: text.confirmedLessons, value: number(summary.confirmedCount) },
            { label: text.scheduledHours, value: number(summary.minutes / 60) },
            { label: text.bookedValue, value: formatAmounts(summary.amounts, language) },
          ].map((metric) => (
            <div key={metric.label} className={styles.metric}>
              <dt>{metric.label}</dt>
              <dd>
                <NotebookMetadata items={hasData ? metric.value : '—'} />
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.monthCaption}>{monthLabel}</p>

        <div className={styles.visuals}>
          <section className={styles.workload} aria-labelledby="tutor-weekly-workload">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="tutor-weekly-workload" className="text-base font-bold">
                  {text.weeklyWorkload}
                </h3>
                <p className="mt-1 text-xs leading-5 text-notebook-muted">
                  {text.workloadDescription}
                </p>
              </div>
              <span className="text-xs text-notebook-muted">{text.hoursUnit}</span>
            </div>
            {!hasData ? (
              <p className="py-8 text-sm text-notebook-muted">—</p>
            ) : maximumMinutes === 0 ? (
              <div className={styles.emptyWorkload}>
                <DashboardIcon name="calendar" className="h-4 w-4 shrink-0 text-tutor-deep/60" />
                <p>{text.noConfirmedLessons}</p>
              </div>
            ) : (
              <>
                <div
                  className="mt-5 flex h-36 items-end gap-3 border-b border-paper-edge px-1 sm:gap-6"
                  aria-hidden="true"
                >
                  {summary.weeks.map((week) => (
                    <div
                      key={week.startDay}
                      className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center"
                    >
                      <p className="text-xs font-semibold tabular-nums text-tutor-deep">
                        {number(week.minutes / 60)}
                      </p>
                      <div
                        className="mx-auto w-full max-w-14 rounded-t-lg border border-b-0 border-tutor-deep/20 bg-sticky-blue"
                        style={{ height: `${(week.minutes / maximumMinutes) * 75}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-3 px-1 sm:gap-6" aria-hidden="true">
                  {summary.weeks.map((week) => (
                    <span
                      key={week.startDay}
                      className="flex-1 text-center text-xs tabular-nums text-notebook-muted"
                    >
                      {week.startDay}–{week.endDay}
                    </span>
                  ))}
                </div>
                <table className="sr-only">
                  <caption>
                    <NotebookMetadata items={[text.weeklyWorkload, monthLabel]} />
                  </caption>
                  <tbody>
                    {summary.weeks.map((week) => (
                      <tr key={week.startDay}>
                        <th scope="row">
                          {week.startDay}–{week.endDay}
                        </th>
                        <td>
                          {number(week.minutes / 60)} {text.hoursUnit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
          <aside className={styles.feedback} aria-labelledby="tutor-student-feedback">
            <h3 id="tutor-student-feedback" className="text-sm font-semibold">
              {text.reviewsTitle}
            </h3>
            {insights?.reviews && (
              <p className="mt-2 text-2xl font-bold tabular-nums">
                {insights?.reviews?.average === undefined || insights.reviews.average === null
                  ? '—'
                  : `${number(insights.reviews.average)} / 5`}
              </p>
            )}
            <p className="mt-2 text-xs leading-6 text-notebook-muted-deep">
              {insights?.reviews
                ? text.reviewCount.replace('{count}', number(insights.reviews.count))
                : text.noReviews}
            </p>
          </aside>
        </div>
        <div className={styles.earnings}>
          <span>{text.receivedRevenue}</span>
          <NotebookMetadata
            items={
              receivedRevenue
                ? formatAmounts(receivedRevenue, language)
                : ['—', text.waitingRevenue]
            }
          />
        </div>
      </div>

      <PaperCard className={panelClass} aria-labelledby="tutor-course-overview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="tutor-course-overview" className="text-base font-bold">
              {text.courseOverview}
            </h3>
            <p className="mt-1 text-xs leading-5 text-notebook-muted">
              <NotebookMetadata items={[text.courseDescription, monthLabel]} />
            </p>
          </div>
          <Link
            href="/dashboard/listings"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-tutor-deep underline decoration-tutor-deep/30 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep/40 focus-visible:ring-offset-2"
          >
            {text.manageCourses}
            <ArrowIcon />
          </Link>
        </div>
        {listings.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-semibold">{text.noListingsYetTitle}</p>
            <p className="mt-2 text-sm leading-6 text-notebook-muted">
              {text.noListingsYetDescription}
            </p>
            <Link
              href="/dashboard/listings/new"
              className={notebookButtonClass({ tone: 'secondary', className: 'mt-4' })}
            >
              <DashboardIcon name="plus" className="h-4 w-4" />
              {text.newListingAction}
            </Link>
          </div>
        ) : (
          <SubjectCourseIndex
            value={selectedCourse?.listing.id ?? null}
            subjectLabel={text.subjectIndexLabel}
            courseLabel={text.subjectCoursesLabel}
            courseCountLabel={text.courseCount}
            hint={text.chooseCourseHint}
            onChange={setSelectedCourseId}
            groups={subjectGroups.map(({ subject, courses }) => ({
              id: subject.id,
              label: subject.name,
              code: subject.code,
              courses: courses.map(({ listing }) => ({
                value: listing.id,
                label: listing.gradeLevel.name,
                description:
                  listing.publicationStatus === 'PUBLISHED'
                    ? text.publishedBadge
                    : listing.publicationStatus === 'DRAFT'
                      ? text.draftBadge
                      : text.archivedBadge,
              })),
            }))}
          >
            {selectedCourse && (
              <div>
                <p className="mb-5 text-xs font-semibold text-tutor-deep">{monthLabel}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
                  {[
                    { label: text.courseConfirmed, value: number(selectedCourse.confirmedCount) },
                    { label: text.coursePending, value: number(selectedCourse.pendingCount) },
                    { label: text.courseHours, value: number(selectedCourse.minutes / 60) },
                    {
                      label: text.courseValue,
                      value: formatAmounts(selectedCourse.amounts, language),
                    },
                  ].map((metric) => (
                    <div key={metric.label}>
                      <dt className="text-xs text-notebook-muted">{metric.label}</dt>
                      <dd className="mt-2 break-words text-xl font-bold tabular-nums sm:text-2xl">
                        <NotebookMetadata items={hasData ? metric.value : '—'} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </SubjectCourseIndex>
        )}
      </PaperCard>
    </section>
  );
}

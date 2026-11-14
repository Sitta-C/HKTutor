'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DashboardLoading } from '@/components/dashboard/dashboard-loading';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { BookingStatusBreakdown } from '@/components/reports/booking-status-breakdown';
import { reportCopy } from '@/components/reports/report-copy';
import { createTutorReportCsv } from '@/components/reports/report-export';
import { createTutorReportViewModel, getReportFailure } from '@/components/reports/report-model';
import { ReportOutcomes } from '@/components/reports/report-outcomes';
import { PaperCard, notebookButtonClass } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getMyTutorReport } from '@/lib/api/reports';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import { formatBangkokShortDate, formatBangkokTime, getBangkokToday } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';
import { ONBOARDING_PROFILE_PATH } from '@/lib/profile-navigation';
import { withReturnTo } from '@/lib/return-to';
import { useProfileSession } from '@/lib/use-profile-session';

import './report-print.css';
import styles from './tutor-report.module.css';

import type { ReportFailure } from '@/components/reports/report-model';
import type { TutorReport } from '@/lib/api/types';

export type TutorReportPanelState =
  | { status: 'loading' }
  | { status: 'success'; report: TutorReport; fetchedAt?: string }
  | { status: 'error'; failure: ReportFailure };

export function TutorReportPanel({
  embedded = false,
  ownerName,
  onRetry,
  state,
}: {
  embedded?: boolean;
  ownerName?: string;
  onRetry: () => void;
  state: TutorReportPanelState;
}) {
  const { language } = useLanguage();
  const copy = reportCopy[language];
  const Heading = embedded ? 'h2' : 'h1';
  const reportViewModel =
    state.status === 'success' ? createTutorReportViewModel(state.report, copy, language) : null;

  return (
    <section
      className={`${styles.panel} ${embedded ? '' : styles.page}`}
      aria-labelledby={embedded ? 'dashboard-report-title' : 'report-page-title'}
      data-tutor-report
      data-report-page={embedded ? undefined : ''}
    >
      <header className={styles.heading}>
        {!embedded && (
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-tutor-deep">
            {copy.eyebrow}
          </p>
        )}
        <Heading
          id={embedded ? 'dashboard-report-title' : 'report-page-title'}
          className={
            embedded
              ? 'text-xl font-bold text-notebook-ink'
              : 'mt-3 text-2xl font-bold leading-tight tracking-tight text-notebook-ink sm:text-3xl'
          }
          tabIndex={-1}
        >
          {copy.title}
        </Heading>
        <p
          className={
            embedded
              ? 'mt-1 text-xs leading-5 text-notebook-muted'
              : 'mt-2 text-sm leading-6 text-notebook-muted'
          }
        >
          {copy.description}
        </p>
        {!embedded && ownerName && (
          <p className="mt-2 break-words text-sm font-semibold text-notebook-ink">{ownerName}</p>
        )}
        {!embedded && state.status === 'success' && state.fetchedAt && (
          <p className={styles.help}>
            {copy.loadedAt
              .replace('{date}', formatBangkokShortDate(state.fetchedAt, language))
              .replace('{time}', formatBangkokTime(state.fetchedAt, language))}
          </p>
        )}
      </header>

      {state.status === 'loading' && <NotebookLoadingRegion label={copy.loading} />}

      {state.status === 'error' && (
        <PaperCard className="max-w-2xl !bg-sticky-pink/50 p-5 sm:p-6" role="alert" tabIndex={-1}>
          <p className="font-bold text-red-900">
            {state.failure === 'session'
              ? copy.sessionExpired
              : state.failure === 'consent'
                ? copy.consentRequired
                : state.failure === 'restricted'
                  ? copy.restricted
                  : copy.loadFailed}
          </p>
          {state.failure === 'consent' && (
            <Link
              href={withReturnTo(
                ONBOARDING_PROFILE_PATH,
                embedded ? '/dashboard' : '/dashboard/reports',
              )}
              className={notebookButtonClass({ tone: 'secondary', className: 'mt-4' })}
            >
              {copy.reviewConsent}
            </Link>
          )}
          {state.failure === 'failed' && (
            <>
              <p className="mt-2 text-sm leading-6 text-red-800">{copy.loadFailedHint}</p>
              <button
                type="button"
                data-report-retry
                className={notebookButtonClass({ tone: 'secondary', className: 'mt-4' })}
                onClick={onRetry}
              >
                {copy.retry}
              </button>
            </>
          )}
        </PaperCard>
      )}

      {reportViewModel && (
        <div data-report-success>
          {!embedded && state.status === 'success' && (
            <div className={styles.actions}>
              <button type="button" className={styles.action} onClick={() => window.print()}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM16 11h1" />
                </svg>
                {copy.print}
              </button>
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([createTutorReportCsv(state.report, copy)], {
                      type: 'text/csv;charset=utf-8',
                    }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `hktutor-teaching-report-${getBangkokToday()}.csv`;
                  link.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
                </svg>
                {copy.downloadCsv}
              </button>
            </div>
          )}
          <div className={styles.sheet}>
            <ReportOutcomes copy={copy} report={reportViewModel} />
            <BookingStatusBreakdown
              copy={copy}
              headingLevel={embedded ? 'h3' : 'h2'}
              report={reportViewModel}
            />
          </div>
          {reportViewModel.isEmpty && <p className={styles.emptyRecord}>{copy.emptyRecord}</p>}
          {embedded ? (
            <div className={styles.footer}>
              <p className={styles.scope}>{copy.allTimeScope}</p>
              <Link href="/dashboard/reports" className={styles.reportLink}>
                {copy.fullReport} <span aria-hidden="true">&nbsp;↗</span>
              </Link>
            </div>
          ) : (
            <>
              <p className={`${styles.help} ${styles.exportHint}`}>{copy.exportHint}</p>
              <section className={styles.definitions} aria-labelledby="report-definitions-title">
                <h2 id="report-definitions-title">{copy.definitionsTitle}</h2>
                <dl>
                  {[
                    [copy.totalBookings, copy.bookingsDefinition],
                    [copy.revenue, copy.revenueDefinition],
                    [copy.completionRate, copy.completionDefinition],
                  ].map(([label, definition]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{definition}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function TutorReportView({
  embedded = false,
  ownerName,
}: {
  embedded?: boolean;
  ownerName?: string;
}) {
  const [state, setState] = useState<TutorReportPanelState>({ status: 'loading' });
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const focusAfterRetry = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  const requestReport = useCallback(() => {
    controller.current?.abort();
    const request = new AbortController();
    const id = requestId.current + 1;
    requestId.current = id;
    controller.current = request;
    void getMyTutorReport(request.signal)
      .then((report) => {
        if (!request.signal.aborted && requestId.current === id) {
          setState({ status: 'success', report, fetchedAt: new Date().toISOString() });
        }
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted && requestId.current === id) {
          setState({ status: 'error', failure: getReportFailure(error) });
        }
      });
  }, []);

  useEffect(() => {
    requestReport();
    return () => controller.current?.abort();
  }, [requestReport]);

  useEffect(() => {
    if (state.status === 'loading' || !focusAfterRetry.current) {
      return;
    }

    focusAfterRetry.current = false;
    const target =
      state.status === 'success'
        ? container.current?.querySelector<HTMLElement>('[data-tutor-report] [tabindex="-1"]')
        : (container.current?.querySelector<HTMLElement>('[data-report-retry]') ??
          container.current?.querySelector<HTMLElement>('[data-tutor-report] [role="alert"]'));
    target?.focus();
  }, [state.status]);

  return (
    <div ref={container}>
      <TutorReportPanel
        embedded={embedded}
        {...(ownerName ? { ownerName } : {})}
        state={state}
        onRetry={() => {
          focusAfterRetry.current = true;
          setState({ status: 'loading' });
          requestReport();
        }}
      />
    </div>
  );
}

export default function TutorReportPage() {
  const { isLoading, logout, profileUser, user } = useProfileSession({
    profileMode: 'required',
    requiredRole: 'TUTOR',
  });
  const router = useRouter();

  if (isLoading || !user || user.role !== 'TUTOR') {
    return <DashboardLoading />;
  }

  const dashboardUser = profileUser ?? user;
  return (
    <DashboardShell
      user={dashboardUser}
      onLogout={async () => {
        await logout();
        router.replace('/');
      }}
    >
      <TutorReportView ownerName={getUserDisplayName(dashboardUser)} />
    </DashboardShell>
  );
}

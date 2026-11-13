'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DashboardLoading } from '@/components/dashboard/dashboard-loading';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { BookingStatusBreakdown } from '@/components/reports/booking-status-breakdown';
import { reportCopy } from '@/components/reports/report-copy';
import { createTutorReportViewModel, getReportFailure } from '@/components/reports/report-model';
import { ReportSummaryCards } from '@/components/reports/report-summary-cards';
import { PaperCard, notebookButtonClass } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getMyTutorReport } from '@/lib/api/reports';
import { useLanguage } from '@/lib/i18n';
import { ONBOARDING_PROFILE_PATH } from '@/lib/profile-navigation';
import { withReturnTo } from '@/lib/return-to';
import { useProfileSession } from '@/lib/use-profile-session';

import type { ReportFailure } from '@/components/reports/report-model';
import type { TutorReport } from '@/lib/api/types';

export type TutorReportPanelState =
  | { status: 'loading' }
  | { status: 'success'; report: TutorReport }
  | { status: 'error'; failure: ReportFailure };

export function TutorReportPanel({
  embedded = false,
  onRetry,
  state,
}: {
  embedded?: boolean;
  onRetry: () => void;
  state: TutorReportPanelState;
}) {
  const { language } = useLanguage();
  const copy = reportCopy[language];
  const Heading = embedded ? 'h3' : 'h1';

  return (
    <section
      className={embedded ? '' : 'pb-12 pt-7 sm:pt-9'}
      aria-labelledby={embedded ? 'dashboard-report-title' : 'report-page-title'}
      data-tutor-report
    >
      <header className="mb-6">
        {!embedded && (
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-tutor-deep">
            {copy.eyebrow}
          </p>
        )}
        <Heading
          id={embedded ? 'dashboard-report-title' : 'report-page-title'}
          className={
            embedded
              ? 'text-base font-bold text-notebook-ink'
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

      {state.status === 'success' && (
        <div data-report-success>
          <ReportSummaryCards
            copy={copy}
            report={createTutorReportViewModel(state.report, copy, language)}
          />
          <BookingStatusBreakdown
            copy={copy}
            headingLevel={embedded ? 'h4' : 'h2'}
            report={createTutorReportViewModel(state.report, copy, language)}
          />
        </div>
      )}
    </section>
  );
}

export function TutorReportView({ embedded = false }: { embedded?: boolean }) {
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
          setState({ status: 'success', report });
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
      <TutorReportView />
    </DashboardShell>
  );
}

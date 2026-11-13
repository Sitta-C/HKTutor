import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BookingStatusBreakdown } from '@/components/reports/booking-status-breakdown';
import { reportCopy } from '@/components/reports/report-copy';
import { createTutorReportViewModel, getReportFailure } from '@/components/reports/report-model';
import { ReportSummaryCards } from '@/components/reports/report-summary-cards';
import {
  TutorReportPanel,
  type TutorReportPanelState,
} from '@/components/reports/tutor-report-page';
import { ApiError } from '@/lib/api/error';
import { LanguageProvider } from '@/lib/i18n';

import type { TutorReport } from '@/lib/api/types';

const report: TutorReport = {
  totalBookings: 12,
  statusCounts: {
    PENDING: 3,
    CONFIRMED: 1,
    COMPLETED: 6,
    CANCELED: 2,
    EXPIRED: 0,
  },
  revenue: { amount: '905.00', currency: 'THB' },
  completionRate: { completed: 6, finalized: 8, percent: 75 },
};

describe('tutor report presentation', () => {
  it('renders the authoritative total, all statuses, paid completed revenue and completion rate', () => {
    const model = createTutorReportViewModel(report, reportCopy.en);
    const markup = renderToStaticMarkup(
      createElement(
        'main',
        null,
        createElement(ReportSummaryCards, { copy: reportCopy.en, report: model }),
        createElement(BookingStatusBreakdown, { copy: reportCopy.en, report: model }),
      ),
    );

    expect(model).toMatchObject({
      totalBookings: '12',
      revenue: 'THB 905.00',
      completionRate: '75%',
    });
    expect(model.statuses.map(({ count }) => count)).toEqual(['3', '1', '6', '2', '0']);
    expect(markup).toContain('Net amount from paid, completed bookings only.');
    expect(markup).toContain('Completed ÷ (completed + canceled).');
    expect(
      markup.match(/rounded-2xl border border-paper-edge bg-white p-5 shadow-note/g),
    ).toHaveLength(3);
    expect(markup).not.toContain('bg-sticky-blue');
    expect(markup).not.toContain('bg-sticky-green');
    expect(markup).not.toContain('bg-sticky-yellow');
    expect(markup).toContain('border-amber-200 bg-amber-50 text-amber-800');
    expect(markup).toContain('border-emerald-200 bg-emerald-50 text-emerald-800');
    expect(markup).toContain('border-stone-200 bg-stone-100 text-stone-700');
    expect(markup.match(/border-red-200 bg-red-50 text-red-800 before:bg-red-500/g)).toHaveLength(
      2,
    );
    expect(markup.match(/<li/g)).toHaveLength(5);
  });

  it('renders the successful empty response as zeros, fixed THB and translated unavailable rate', () => {
    const empty = createTutorReportViewModel(
      {
        totalBookings: 0,
        statusCounts: { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, EXPIRED: 0 },
        revenue: { amount: '0.00', currency: 'THB' },
        completionRate: { completed: 0, finalized: 0, percent: null },
      },
      reportCopy.th,
    );

    expect(empty.totalBookings).toBe('0');
    expect(empty.revenue).toBe('THB 0.00');
    expect(empty.completionRate).toBe('ไม่มีข้อมูล');
    expect(empty.statuses.every(({ count }) => count === '0')).toBe(true);
  });

  it('keeps loading and failed requests free of optimistic zeros and offers retry only for failures', () => {
    const render = (state: TutorReportPanelState) =>
      renderToStaticMarkup(
        createElement(
          LanguageProvider,
          null,
          createElement(TutorReportPanel, { state, onRetry: vi.fn() }),
        ),
      );
    const loading = render({ status: 'loading' });
    const failed = render({ status: 'error', failure: 'failed' });
    const restricted = render({ status: 'error', failure: 'restricted' });

    expect(loading).toContain('Loading your all-time report');
    expect(loading).not.toContain('THB 0.00');
    expect(failed).toContain('We could not load your report.');
    expect(failed).toContain('Try again');
    expect(failed).not.toContain('THB 0.00');
    expect(restricted).toContain('available only to tutor accounts');
    expect(restricted).not.toContain('Try again');
  });

  it('uses the analytics heading hierarchy without the report eyebrow when embedded', () => {
    const markup = renderToStaticMarkup(
      createElement(
        LanguageProvider,
        null,
        createElement(TutorReportPanel, {
          embedded: true,
          state: { status: 'success', report },
          onRetry: vi.fn(),
        }),
      ),
    );

    expect(markup).toContain('<h3 id="dashboard-report-title"');
    expect(markup).toContain('class="text-base font-bold text-notebook-ink"');
    expect(markup).toContain('<h4 id="report-status-title"');
    expect(markup).not.toContain('Teaching record');
  });

  it('distinguishes expired sessions and restricted roles from retryable failures', () => {
    expect(getReportFailure(new ApiError('Unauthorized', 401))).toBe('session');
    expect(getReportFailure(new ApiError('Forbidden', 403))).toBe('restricted');
    expect(getReportFailure(new ApiError('Unavailable', 503))).toBe('failed');
    expect(getReportFailure(new TypeError('network'))).toBe('failed');
  });
});

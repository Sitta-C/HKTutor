import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BookingStatusBreakdown } from '@/components/reports/booking-status-breakdown';
import { reportCopy } from '@/components/reports/report-copy';
import { createTutorReportViewModel, getReportFailure } from '@/components/reports/report-model';
import { ReportOutcomes } from '@/components/reports/report-outcomes';
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
    const model = createTutorReportViewModel(report, reportCopy.en, 'en');
    const markup = renderToStaticMarkup(
      createElement(
        'main',
        null,
        createElement(ReportOutcomes, { copy: reportCopy.en, report: model }),
        createElement(BookingStatusBreakdown, { copy: reportCopy.en, report: model }),
      ),
    );

    expect(model).toMatchObject({
      totalBookings: '12',
      revenue: 'THB\u00a0905.00',
      completionRate: '75%',
    });
    expect(model.statuses.map(({ count }) => count)).toEqual(['3', '1', '6', '2', '0']);
    expect(markup).toContain('From paid, completed lessons only, after discounts.');
    expect(markup).toContain('6 completed out of 8 finalized lessons');
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
      'th',
    );

    expect(empty.totalBookings).toBe('0');
    expect(empty.revenue).toBe('฿0.00');
    expect(empty.completionRate).toBe('—');
    expect(empty.completionContext).toBe(reportCopy.th.noFinalizedLessons);
    expect(empty.statuses.every(({ count }) => count === '0')).toBe(true);
  });

  it('formats the fixed-decimal revenue by locale without losing precision', () => {
    const preciseReport = {
      ...report,
      revenue: { amount: '9007199254740993.07', currency: 'THB' as const },
    };

    expect(createTutorReportViewModel(preciseReport, reportCopy.en, 'en').revenue).toBe(
      'THB\u00a09,007,199,254,740,993.07',
    );
    expect(createTutorReportViewModel(preciseReport, reportCopy.th, 'th').revenue).toBe(
      '฿9,007,199,254,740,993.07',
    );
  });

  // S3-T11: the API owns HALF_UP rounding; the page must show its value without re-rounding.
  it.each([
    [{ completed: 1, finalized: 32, percent: 3.13 }, '3.13%'],
    [{ completed: 2, finalized: 3, percent: 66.67 }, '66.67%'],
    [{ completed: 1, finalized: 3, percent: 33.33 }, '33.33%'],
    [{ completed: 4, finalized: 5, percent: 80 }, '80%'],
    [{ completed: 3, finalized: 3, percent: 100 }, '100%'],
    [{ completed: 0, finalized: 2, percent: 0 }, '0%'],
  ])('shows the API completion rate %o as %s in both languages', (completionRate, expected) => {
    const rated = { ...report, completionRate };

    expect(createTutorReportViewModel(rated, reportCopy.en, 'en').completionRate).toBe(expected);
    expect(createTutorReportViewModel(rated, reportCopy.th, 'th').completionRate).toBe(expected);
  });

  it('shows N/A in English for a null rate instead of a fabricated 0%', () => {
    const unfinalized = {
      ...report,
      completionRate: { completed: 0, finalized: 0, percent: null },
    };

    expect(createTutorReportViewModel(unfinalized, reportCopy.en, 'en').completionRate).toBe('N/A');
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
    const consent = render({ status: 'error', failure: 'consent' });

    expect(loading).toContain('Loading your all-time report');
    expect(loading).not.toContain('฿0.00');
    expect(failed).toContain('We could not load your report.');
    expect(failed).toContain('Try again');
    expect(failed).not.toContain('฿0.00');
    expect(restricted).toContain('available only to tutor accounts');
    expect(restricted).not.toContain('Try again');
    expect(consent).toContain('Accept the current privacy notice');
    expect(consent).toContain('/onboarding/profile?returnTo=%2Fdashboard%2Freports');
    expect(consent).toContain('Review privacy notice');
  });

  it('uses a sibling section heading for the all-time summary when embedded', () => {
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

    expect(markup).toContain('<h2 id="dashboard-report-title"');
    expect(markup).toContain('class="text-xl font-bold text-notebook-ink"');
    expect(markup).toContain('<h3 id="report-status-title"');
    expect(markup).not.toContain('Teaching record');
  });

  it('distinguishes expired sessions and restricted roles from retryable failures', () => {
    expect(getReportFailure(new ApiError('Unauthorized', 401))).toBe('session');
    expect(getReportFailure(new ApiError('Forbidden', 403))).toBe('restricted');
    expect(
      getReportFailure(new ApiError('Accept the current privacy notice to continue.', 403)),
    ).toBe('consent');
    expect(getReportFailure(new ApiError('Unavailable', 503))).toBe('failed');
    expect(getReportFailure(new TypeError('network'))).toBe('failed');
  });
});

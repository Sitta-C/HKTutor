import { ApiError } from '@/lib/api/error';
import { getCalendarLocale } from '@/lib/date-time';

import type { ReportCopy } from '@/components/reports/report-copy';
import type { BookingStatus, TutorReport } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export type ReportFailure = 'session' | 'consent' | 'restricted' | 'failed';

export interface TutorReportViewModel {
  totalBookings: string;
  revenue: string;
  completionRate: string;
  statuses: { status: BookingStatus; label: string; count: string }[];
}

const REPORT_STATUSES: readonly BookingStatus[] = [
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
];

export function createTutorReportViewModel(
  report: TutorReport,
  copy: ReportCopy,
  language: Language,
): TutorReportViewModel {
  return {
    totalBookings: String(report.totalBookings),
    revenue: formatFixedCurrency(report.revenue.amount, report.revenue.currency, language),
    completionRate:
      report.completionRate.percent === null
        ? copy.unavailable
        : `${formatPercent(report.completionRate.percent)}%`,
    statuses: REPORT_STATUSES.map((status) => ({
      status,
      label: copy.status[status],
      count: String(report.statusCounts[status]),
    })),
  };
}

export function getReportFailure(error: unknown): ReportFailure {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'session';
    if (error.status === 403) {
      return error.message === 'Accept the current privacy notice to continue.'
        ? 'consent'
        : 'restricted';
    }
  }
  return 'failed';
}

function formatFixedCurrency(amount: string, currency: string, language: Language): string {
  const match = /^(\d+)\.(\d{2})$/.exec(amount);
  if (!match?.[1] || !match[2]) return `${amount} ${currency}`;

  const formatter = new Intl.NumberFormat(getCalendarLocale(language), {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const wholeUnits = BigInt(match[1]);
  return formatter
    .formatToParts(wholeUnits)
    .map((part) => (part.type === 'fraction' ? match[2] : part.value))
    .join('');
}

function formatPercent(percent: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(percent);
}

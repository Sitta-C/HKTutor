import { ApiError } from '@/lib/api/error';

import type { ReportCopy } from '@/components/reports/report-copy';
import type { BookingStatus, TutorReport } from '@/lib/api/types';

export type ReportFailure = 'session' | 'restricted' | 'failed';

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
): TutorReportViewModel {
  return {
    totalBookings: String(report.totalBookings),
    revenue: `${report.revenue.currency} ${formatFixedAmount(report.revenue.amount)}`,
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
    if (error.status === 403) return 'restricted';
  }
  return 'failed';
}

function formatFixedAmount(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(percent: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(percent);
}

import { REPORT_STATUSES } from '@/components/reports/report-model';

import type { ReportCopy } from '@/components/reports/report-copy';
import type { TutorReport } from '@/lib/api/types';

/** Keep the API's decimal money and rounded rate intact in the exported summary. */
export function createTutorReportCsv(report: TutorReport, copy: ReportCopy): string {
  const rows = [
    [copy.csvMetric, copy.csvValue, copy.csvCurrency, copy.csvDefinition],
    [copy.totalBookings, String(report.totalBookings), '', copy.bookingsDefinition],
    ...REPORT_STATUSES.map((status) => [
      copy.status[status],
      String(report.statusCounts[status]),
      '',
      '',
    ]),
    [copy.revenue, report.revenue.amount, report.revenue.currency, copy.revenueDefinition],
    [copy.completedLessons, String(report.completionRate.completed), '', ''],
    [copy.finalizedLessons, String(report.completionRate.finalized), '', ''],
    [
      `${copy.completionRate} (%)`,
      report.completionRate.percent === null ? '' : String(report.completionRate.percent),
      '',
      copy.completionDefinition,
    ],
  ];
  return (
    '\uFEFF' +
    rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') +
    '\r\n'
  );
}

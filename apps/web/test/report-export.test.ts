import { describe, expect, it } from 'vitest';

import { reportCopy } from '@/components/reports/report-copy';
import { createTutorReportCsv } from '@/components/reports/report-export';

import type { TutorReport } from '@/lib/api/types';

const report: TutorReport = {
  totalBookings: 12,
  statusCounts: { PENDING: 3, CONFIRMED: 1, COMPLETED: 6, CANCELED: 2, EXPIRED: 0 },
  revenue: { amount: '9007199254740993.07', currency: 'THB' },
  completionRate: { completed: 6, finalized: 8, percent: 75 },
};

describe('teaching summary CSV', () => {
  it('preserves exact decimal money, all statuses and the API numerator/denominator', () => {
    const csv = createTutorReportCsv(report, reportCopy.en);
    expect(csv).toContain('"Net teaching revenue","9007199254740993.07","THB"');
    expect(csv).toContain('"Completed lessons","6"');
    expect(csv).toContain('"Finalized lessons","8"');
    expect(csv).toContain('"Completion rate (%)","75"');
    for (const [status, label] of Object.entries(reportCopy.en.status)) {
      expect(csv).toContain(
        `"${label}","${report.statusCounts[status as keyof TutorReport['statusCounts']]}"`,
      );
    }
    expect(csv).toContain('paid and completed');
  });

  it('supports Thai spreadsheets and exports an unavailable rate as blank, never zero', () => {
    const csv = createTutorReportCsv(
      { ...report, completionRate: { completed: 0, finalized: 0, percent: null } },
      reportCopy.th,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"อัตราการสอนสำเร็จ (%)",""');
    expect(csv).not.toContain('undefined');
  });
});

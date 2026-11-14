import styles from './tutor-report.module.css';

import type { ReportCopy } from '@/components/reports/report-copy';
import type { TutorReportViewModel } from '@/components/reports/report-model';

export function ReportOutcomes({
  copy,
  report,
}: {
  copy: ReportCopy;
  report: TutorReportViewModel;
}) {
  return (
    <dl className={styles.outcomes}>
      <div className={styles.revenue}>
        <dt className={styles.metricLabel}>{copy.revenue}</dt>
        <dd className={styles.revenueValue}>{report.revenue}</dd>
        <p className={styles.help}>{copy.revenueExplanation}</p>
      </div>
      <div className={styles.completion}>
        <dt className={styles.metricLabel}>{copy.completionRate}</dt>
        <dd className={report.hasCompletionRate ? styles.rate : styles.unavailable}>
          {report.completionRate}
        </dd>
        <p className={styles.completionContext}>{report.completionContext}</p>
      </div>
    </dl>
  );
}

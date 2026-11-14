import styles from './tutor-report.module.css';

import type { ReportCopy } from '@/components/reports/report-copy';
import type { TutorReportViewModel } from '@/components/reports/report-model';

export function BookingStatusBreakdown({
  copy,
  headingLevel = 'h2',
  report,
}: {
  copy: ReportCopy;
  headingLevel?: 'h2' | 'h3';
  report: TutorReportViewModel;
}) {
  const Heading = headingLevel;
  return (
    <section
      className={styles.ledger}
      aria-labelledby="report-status-title"
      data-empty={report.isEmpty}
    >
      <Heading id="report-status-title" className={styles.ledgerTitle}>
        {copy.statusTitle}
      </Heading>
      <dl className={styles.total}>
        <dt>{copy.totalBookings}</dt>
        <dd>{report.totalBookings}</dd>
      </dl>
      <ul className={styles.statuses}>
        {report.statuses.map((item) => (
          <li key={item.status} className={styles.statusRow} data-status={item.status}>
            <span className={styles.statusLabel}>{item.label}</span>
            <span className={styles.statusCount} aria-label={`${item.label}: ${item.count}`}>
              {item.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

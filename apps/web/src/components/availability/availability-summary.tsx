import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { useLanguage } from '@/lib/i18n';

import styles from './availability-summary.module.css';

export function AvailabilitySummary({
  label,
  openSlotCount,
  reservedSlotCount,
  isLoading,
  hasError,
}: {
  label: string;
  openSlotCount: number;
  reservedSlotCount: number;
  isLoading: boolean;
  hasError: boolean;
}) {
  const { copy } = useLanguage();
  const availabilityCopy = copy.dashboard.availability;
  const showCounts = !isLoading && !hasError;

  return (
    <section
      className={styles.ledger}
      aria-label={label}
      aria-busy={isLoading}
      data-availability-summary
    >
      <dl className={styles.metrics}>
        <div className={styles.metric}>
          <dt className={styles.label}>
            <DashboardIcon name="clock" className={styles.openIcon ?? ''} />
            {availabilityCopy.openSlots}
          </dt>
          <dd className={styles.amount}>
            <span className={styles.number}>{showCounts ? openSlotCount : '—'}</span>
            {showCounts && <span className={styles.unit}>{availabilityCopy.slotUnit}</span>}
          </dd>
          <dd className={styles.help}>{availabilityCopy.openSlotsHelp}</dd>
        </div>
        <div className={styles.metric}>
          <dt className={styles.label}>
            <DashboardIcon name="calendar" className={styles.bookedIcon ?? ''} />
            {availabilityCopy.reservedSlots}
          </dt>
          <dd className={styles.amount}>
            <span className={styles.number}>{showCounts ? reservedSlotCount : '—'}</span>
            {showCounts && <span className={styles.unit}>{availabilityCopy.slotUnit}</span>}
          </dd>
          <dd className={styles.help}>{availabilityCopy.reservedSlotsHelp}</dd>
        </div>
      </dl>
      <div className={styles.footer}>
        <span className={styles.zoneLabel}>
          <DashboardIcon name="clock" className={styles.zoneIcon ?? ''} />
          <span>{availabilityCopy.timezoneLabel} · Asia/Bangkok</span>
        </span>
        <span className={styles.zoneTag}>{availabilityCopy.timezone}</span>
      </div>
    </section>
  );
}

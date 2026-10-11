import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { tutorVerificationCopy, visibleTutorVerificationStatus } from '@/lib/tutor-verification';

import styles from './tutor-verification-badge.module.css';

import type { TutorVerificationAudience } from '@/lib/tutor-verification';

type VerificationProps = {
  status: unknown;
  language: 'en' | 'th';
};

export function TutorVerificationBadge({
  status,
  language,
  audience,
  compact = false,
}: VerificationProps & { audience: TutorVerificationAudience; compact?: boolean }) {
  const visibleStatus = visibleTutorVerificationStatus(status, audience);
  if (!visibleStatus) {
    return null;
  }
  return (
    <span
      className={`${styles.badge} ${compact ? styles.compact : ''}`}
      data-tutor-verification={visibleStatus}
    >
      <DashboardIcon
        name={
          visibleStatus === 'VERIFIED' ? 'shield' : visibleStatus === 'PENDING' ? 'clock' : 'info'
        }
        className={styles.icon ?? ''}
      />
      <span>{tutorVerificationCopy[language][visibleStatus].label}</span>
    </span>
  );
}

export function TutorVerificationGuidance({
  status,
  language,
  documentsHref,
}: VerificationProps & { documentsHref: string }) {
  const visibleStatus = visibleTutorVerificationStatus(status, 'owner');
  if (!visibleStatus) {
    return null;
  }
  const text = tutorVerificationCopy[language];
  return (
    <div className={styles.guidance} data-verification-guidance={visibleStatus}>
      <p>{text[visibleStatus].description}</p>
      {visibleStatus !== 'VERIFIED' && (
        <a className={styles.documents} href={documentsHref}>
          {text.documents}
          <DashboardIcon name="arrow-right" className={styles.icon ?? ''} />
        </a>
      )}
    </div>
  );
}

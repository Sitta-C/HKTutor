'use client';

import { useId, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { TutorRatingSummary } from '@/components/tutors/tutor-rating-summary';
import {
  TutorVerificationBadge,
  TutorVerificationGuidance,
} from '@/components/tutors/tutor-verification-badge';

import styles from './tutor-profile-summary.module.css';

import type { TutorProfile } from '@/lib/api/types';

interface TutorProfileSummaryProps {
  email: string;
  language: 'en' | 'th';
  documentsHref?: string | undefined;
  tutorMeta: Pick<TutorProfile, 'ratingAverage' | 'reviewCount' | 'verificationStatus'>;
}

export function TutorProfileSummary({
  email,
  language,
  documentsHref,
  tutorMeta,
}: TutorProfileSummaryProps) {
  const text = copy[language];
  const noticeId = useId();
  const [showReviewsNotice, setShowReviewsNotice] = useState(false);

  return (
    <section className={styles.summary} aria-label={text.title} data-profile-summary>
      <div className={styles.fields}>
        <dl className={styles.field}>
          <dt className={styles.caption}>{text.accountEmail}</dt>
          <dd className={`${styles.value} ${styles.email}`}>{email}</dd>
        </dl>
        <dl className={styles.field}>
          <dt className={styles.caption}>{text.verification}</dt>
          <dd className={styles.statusValue}>
            <TutorVerificationBadge
              status={tutorMeta.verificationStatus}
              language={language}
              audience="owner"
            />
            <TutorVerificationGuidance
              status={tutorMeta.verificationStatus}
              language={language}
              documentsHref={documentsHref}
            />
          </dd>
        </dl>
        <div className={`${styles.field} ${styles.feedback}`}>
          <p className={styles.caption}>{text.feedback}</p>
          <div className={styles.feedbackValue}>
            <TutorRatingSummary
              ratingAverage={tutorMeta.ratingAverage}
              reviewCount={tutorMeta.reviewCount}
              language={language}
            />
            {tutorMeta.reviewCount > 0 && (
              <button
                type="button"
                className={styles.reviewLink}
                aria-expanded={showReviewsNotice}
                aria-controls={noticeId}
                onClick={() => setShowReviewsNotice(true)}
              >
                {text.readReviews}
                <DashboardIcon name="arrow-right" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {tutorMeta.reviewCount > 0 && (
            <p
              id={noticeId}
              className={styles.reviewNotice}
              role="status"
              hidden={!showReviewsNotice}
            >
              {text.reviewsUnavailable}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const copy = {
  en: {
    title: 'Tutor account summary',
    accountEmail: 'Account email',
    verification: 'Tutor verification',
    feedback: 'Rating and reviews',
    readReviews: 'Read all reviews',
    reviewsUnavailable: 'Individual reviews are not available to read yet.',
  },
  th: {
    title: 'สรุปบัญชีติวเตอร์',
    accountEmail: 'อีเมลบัญชี',
    verification: 'สถานะติวเตอร์',
    feedback: 'คะแนนและรีวิว',
    readReviews: 'อ่านรีวิวทั้งหมด',
    reviewsUnavailable: 'ยังไม่เปิดให้อ่านรีวิวรายรายการในขณะนี้',
  },
} as const;

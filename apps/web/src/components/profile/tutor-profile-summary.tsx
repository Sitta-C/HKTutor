'use client';

import { useId, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { buildProfileRatingSummary } from '@/components/profile/profile-rating-model';
import { StatusBadge } from '@/components/ui/notebook';

import styles from './tutor-profile-summary.module.css';

import type { TutorProfile } from '@/lib/api/types';

interface TutorProfileSummaryProps {
  email: string;
  language: 'en' | 'th';
  tutorMeta: Pick<TutorProfile, 'ratingAverage' | 'reviewCount' | 'verificationStatus'>;
}

export function TutorProfileSummary({ email, language, tutorMeta }: TutorProfileSummaryProps) {
  const text = copy[language];
  const noticeId = useId();
  const [showReviewsNotice, setShowReviewsNotice] = useState(false);
  const { score, starFills } = buildProfileRatingSummary(
    tutorMeta.ratingAverage,
    tutorMeta.reviewCount,
  );
  const verified = tutorMeta.verificationStatus === 'VERIFIED';
  const rejected = tutorMeta.verificationStatus === 'REJECTED';
  const scoreLabel =
    score === null ? text.noRating : text.ratingLabel.replace('{score}', score.toFixed(1));

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
            <StatusBadge
              tone={verified ? 'tutor' : rejected ? 'danger' : 'warning'}
              className={styles.badge ?? ''}
            >
              <DashboardIcon
                name={verified ? 'shield' : rejected ? 'info' : 'clock'}
                className="h-3.5 w-3.5 shrink-0"
              />
              {text.status[tutorMeta.verificationStatus]}
            </StatusBadge>
          </dd>
        </dl>
        <div className={`${styles.field} ${styles.feedback}`}>
          <p className={styles.caption}>{text.feedback}</p>
          <div className={styles.feedbackValue}>
            <div className={styles.feedbackDetails}>
              <div className={styles.scoreLine} role="img" aria-label={scoreLabel}>
                <span className={styles.number} aria-hidden="true">
                  <strong>{score === null ? '—' : score.toFixed(1)}</strong>
                  {score !== null && <span>/ 5</span>}
                </span>
                <span className={styles.stars} aria-hidden="true">
                  {starFills.map((fill, index) => (
                    <span key={index} className={styles.star} data-rating-fill={fill}>
                      <DashboardIcon name="star" className={styles.starOutline ?? ''} />
                      <span
                        className={styles.starFilled}
                        style={{ clipPath: `inset(0 ${100 - fill}% 0 0)` }}
                      >
                        <DashboardIcon name="star" className={styles.starIcon ?? ''} />
                      </span>
                    </span>
                  ))}
                </span>
              </div>
              <p className={styles.reviewCount}>
                {tutorMeta.reviewCount === 0
                  ? text.newTutor
                  : text.reviewCount.replace(
                      '{count}',
                      new Intl.NumberFormat(language).format(tutorMeta.reviewCount),
                    )}
              </p>
            </div>
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
    ratingLabel: 'Rated {score} out of 5 stars',
    noRating: 'No rating yet',
    newTutor: 'New tutor · No reviews yet',
    reviewCount: 'From {count} reviews',
    readReviews: 'Read all reviews',
    reviewsUnavailable: 'Individual reviews are not available to read yet.',
    status: {
      VERIFIED: 'Verified',
      PENDING: 'Pending review',
      REJECTED: 'Not verified',
    },
  },
  th: {
    title: 'สรุปบัญชีติวเตอร์',
    accountEmail: 'อีเมลบัญชี',
    verification: 'สถานะติวเตอร์',
    feedback: 'คะแนนและรีวิว',
    ratingLabel: 'คะแนน {score} จาก 5 ดาว',
    noRating: 'ยังไม่มีคะแนนรีวิว',
    newTutor: 'ติวเตอร์ใหม่ · ยังไม่มีรีวิว',
    reviewCount: 'จาก {count} รีวิว',
    readReviews: 'อ่านรีวิวทั้งหมด',
    reviewsUnavailable: 'ยังไม่เปิดให้อ่านรีวิวรายรายการในขณะนี้',
    status: {
      VERIFIED: 'ผ่านการตรวจสอบแล้ว',
      PENDING: 'รอการตรวจสอบ',
      REJECTED: 'ไม่ผ่านการตรวจสอบ',
    },
  },
} as const;

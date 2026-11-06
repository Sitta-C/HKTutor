import { buildTutorRatingSummary } from '@/components/tutors/tutor-rating-model';

import styles from './tutor-rating-summary.module.css';

interface TutorRatingSummaryProps {
  ratingAverage: number | string | null;
  reviewCount: number;
  language: 'en' | 'th';
  compact?: boolean;
}

export function TutorRatingSummary({
  ratingAverage,
  reviewCount,
  language,
  compact = false,
}: TutorRatingSummaryProps) {
  const text = copy[language];
  const summary = buildTutorRatingSummary(ratingAverage, reviewCount);
  const count =
    summary.reviewCount === null
      ? '—'
      : new Intl.NumberFormat(language).format(summary.reviewCount);

  return (
    <div
      className={styles.summary}
      data-tutor-rating={summary.state}
      data-compact={compact ? '' : undefined}
    >
      <div className={styles.content}>
        <div className={styles.rating}>
          {summary.score !== null ? (
            <>
              <p className={styles.label}>{text.average}</p>
              <span
                className={styles.score}
                role="img"
                aria-label={text.ratingLabel.replace('{score}', summary.score)}
              >
                <strong aria-hidden="true">{summary.score}</strong>
                <span className={styles.outOf} aria-hidden="true">
                  / 5
                </span>
              </span>
            </>
          ) : (
            <>
              <p className={styles.state}>
                {summary.state === 'new' ? text.newTutor : text.unavailable}
              </p>
              {summary.state === 'new' && <p className={styles.hint}>{text.noReviews}</p>}
            </>
          )}
        </div>
        <p className={styles.count}>
          <strong>{count}</strong>{' '}
          <span>{summary.reviewCount === 1 ? text.review : text.reviews}</span>
        </p>
      </div>
    </div>
  );
}

const copy = {
  en: {
    average: 'Average rating',
    ratingLabel: 'Rated {score} out of 5',
    newTutor: 'New tutor',
    noReviews: 'No reviews yet',
    unavailable: 'Rating unavailable',
    review: 'review',
    reviews: 'reviews',
  },
  th: {
    average: 'คะแนนเฉลี่ย',
    ratingLabel: 'คะแนน {score} จาก 5',
    newTutor: 'ติวเตอร์ใหม่',
    noReviews: 'ยังไม่มีรีวิว',
    unavailable: 'ยังไม่สามารถแสดงคะแนน',
    review: 'รีวิว',
    reviews: 'รีวิว',
  },
} as const;

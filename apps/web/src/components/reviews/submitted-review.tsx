import { reviewCopy } from '@/components/reviews/review-copy';
import { formatBangkokDateTime } from '@/lib/date-time';

import styles from './review.module.css';

import type { BookingReview } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export function SubmittedReview({
  review,
  language,
}: {
  review: BookingReview;
  language: Language;
}) {
  const text = reviewCopy[language];
  return (
    <section className={styles.saved} aria-label={text.savedTitle}>
      <div className={styles.savedLead}>
        <h2 className={styles.savedHeading}>{text.savedTitle}</h2>
        <p className={styles.savedOverall}>
          {text.savedOverall}:{' '}
          <strong className={styles.savedOverallValue}>
            {review.overallRating.toFixed(2)} / 5
          </strong>
        </p>
      </div>
      <dl className={styles.savedRatings}>
        {(
          [
            [text.clarityLegend, review.clarity],
            [text.punctualityLegend, review.punctuality],
            [text.preparationLegend, review.preparation],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value} / 5</dd>
          </div>
        ))}
      </dl>
      <div className={styles.savedFeedbackBlock}>
        <p className={styles.savedFeedbackLabel}>{text.savedFeedback}</p>
        <p className={styles.savedFeedback}>{review.feedback}</p>
      </div>
      <p className={styles.savedTimestamp}>
        {text.savedAt}:{' '}
        <time dateTime={review.createdAt}>{formatBangkokDateTime(review.createdAt, language)}</time>
      </p>
    </section>
  );
}

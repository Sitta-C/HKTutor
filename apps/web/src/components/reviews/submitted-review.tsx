import { reviewCopy } from '@/components/reviews/review-copy';
import { ReviewDimensions, ReviewScore } from '@/components/reviews/review-summary';
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
        <div>
          <h2 className={styles.savedHeading}>{text.savedTitle}</h2>
          <p className={styles.savedTimestamp}>
            {text.savedAt}:{' '}
            <time dateTime={review.createdAt}>
              {formatBangkokDateTime(review.createdAt, language)}
            </time>
          </p>
        </div>
        <ReviewScore value={review.overallRating} language={language} />
      </div>
      <div className={styles.savedFeedbackBlock}>
        <p className={styles.savedFeedbackLabel}>{text.savedFeedback}</p>
        <p className={styles.savedFeedback}>{review.feedback}</p>
      </div>
      <ReviewDimensions ratings={review} language={language} />
    </section>
  );
}

import { reviewCopy } from '@/components/reviews/review-copy';
import { ReviewDimensions, ReviewScore } from '@/components/reviews/review-summary';
import { formatBangkokDateTime } from '@/lib/date-time';

import styles from './review-entry.module.css';

import type { BookingReview } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export function ReviewEntry({
  review,
  language,
  author,
}: {
  review: BookingReview;
  language: Language;
  author?: string;
}) {
  const text = reviewCopy[language];
  return (
    <div className={styles.entry} data-review-entry>
      <div className={styles.margin}>
        <ReviewScore value={review.overallRating} language={language} />
      </div>
      <div className={styles.content}>
        <blockquote className={styles.feedback}>{review.feedback}</blockquote>
        <div className={styles.attribution}>
          {author !== undefined && <h3>{author}</h3>}
          <p>
            {author === undefined && <>{text.savedAt}: </>}
            <time dateTime={review.createdAt}>
              {formatBangkokDateTime(review.createdAt, language)}
            </time>
          </p>
        </div>
        <details className={styles.details}>
          <summary>{text.ratingsDetails}</summary>
          <ReviewDimensions ratings={review} language={language} />
        </details>
      </div>
    </div>
  );
}

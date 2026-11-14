import { reviewCopy } from '@/components/reviews/review-copy';
import { ReviewEntry } from '@/components/reviews/review-entry';

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
      <h2 className={styles.savedHeading}>{text.savedTitle}</h2>
      <div className={styles.savedSheet}>
        <ReviewEntry review={review} language={language} />
      </div>
    </section>
  );
}

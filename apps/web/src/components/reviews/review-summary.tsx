import { reviewCopy } from '@/components/reviews/review-copy';

import styles from './review-summary.module.css';

import type { Language } from '@/lib/i18n';

export function ReviewScore({ value, language }: { value: number; language: Language }) {
  const text = reviewCopy[language];
  const score = value.toFixed(2);
  return (
    <span
      className={styles.score}
      role="img"
      aria-label={`${text.savedOverall} ${score} ${text.ratingOption}`}
    >
      <span className={styles.scoreLabel} aria-hidden="true">
        {text.savedOverall}
      </span>
      <span className={styles.scoreValue} aria-hidden="true">
        <strong>{score}</strong>
        <span>/ 5</span>
      </span>
    </span>
  );
}

/** Content-sized criteria stay secondary to the feedback in every review context. */
export function ReviewDimensions({
  ratings,
  language,
}: {
  ratings: Record<'clarity' | 'punctuality' | 'preparation', number | null>;
  language: Language;
}) {
  const text = reviewCopy[language];
  return (
    <dl className={styles.dimensions} data-review-dimensions>
      {(
        [
          [text.clarityShort, ratings.clarity],
          [text.punctualityShort, ratings.punctuality],
          [text.preparationShort, ratings.preparation],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {value ?? '—'}
            <span> / 5</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

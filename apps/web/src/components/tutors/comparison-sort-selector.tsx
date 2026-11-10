'use client';

import { useId } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';

import styles from './comparison-sort-selector.module.css';

import type { TutorComparisonCopy } from '@/components/tutors/tutor-comparison-copy';
import type { ComparisonSort } from '@/components/tutors/tutor-comparison-sort';
import type { ReactNode } from 'react';

const PRIORITIES = ['lowest_price', 'highest_rating', 'earliest_availability'] as const;

export function ComparisonSortSelector({
  sort,
  disabled,
  onChange,
  text,
}: {
  sort: ComparisonSort;
  disabled: boolean;
  onChange: (sort: ComparisonSort) => void;
  text: TutorComparisonCopy;
}): ReactNode {
  const id = useId();
  return (
    <fieldset className={styles.root} disabled={disabled} aria-describedby={`${id}-hint`}>
      <legend className="sr-only">{text.sortBy}</legend>
      <span className={styles.label} aria-hidden="true">
        {text.sortBy}
      </span>
      <div className={styles.options}>
        {PRIORITIES.map((priority) => (
          <label key={priority} className={styles.option}>
            <input
              type="radio"
              name={`${id}-sort`}
              value={priority}
              aria-label={text[priority]}
              checked={sort === priority}
              onChange={() => onChange(priority)}
              onClick={() => {
                // A checked default can also repair an invalid query value.
                if (sort === priority) {
                  onChange(priority);
                }
              }}
            />
            {priority === 'lowest_price' ? (
              <span className={styles.currency} aria-hidden="true">
                ฿
              </span>
            ) : (
              <DashboardIcon name={priority === 'highest_rating' ? 'star' : 'calendar'} />
            )}
            <span className={styles.fullLabel}>{text[priority]}</span>
            <span className={styles.shortLabel} aria-hidden="true">
              {text[`${priority}_short`]}
            </span>
          </label>
        ))}
      </div>
      <p id={`${id}-hint`} className="sr-only">
        {text.sortHint}
      </p>
    </fieldset>
  );
}

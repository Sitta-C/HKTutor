import { Fragment } from 'react';

import styles from './notebook-metadata.module.css';

import type { ReactNode } from 'react';

/** Group short labels without visible punctuation; translated compound copy retains its parts. */
export function NotebookMetadata({ items }: { items: string | readonly ReactNode[] }) {
  const parts = typeof items === 'string' ? items.split(' · ') : items;
  return (
    <span className={styles.group} data-notebook-metadata>
      {parts.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && ' '}
          <span className={styles.item}>{item}</span>
        </Fragment>
      ))}
    </span>
  );
}

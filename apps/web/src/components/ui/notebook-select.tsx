import styles from './notebook-select.module.css';

import type { SelectHTMLAttributes } from 'react';

type NotebookSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  controlSize?: 'compact' | 'regular';
};

export function NotebookSelect({
  children,
  className = '',
  controlSize = 'regular',
  ...props
}: NotebookSelectProps) {
  return (
    <span className={styles.wrapper}>
      <select
        {...props}
        className={`${styles.select} ${controlSize === 'compact' ? styles.compact : ''} ${className}`}
      >
        {children}
      </select>
      <span className={styles.chevron} aria-hidden="true" />
    </span>
  );
}

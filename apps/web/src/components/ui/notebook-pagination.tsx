'use client';

import { useLanguage } from '@/lib/i18n';

import styles from './notebook-pagination.module.css';

export function NotebookPagination({
  page,
  total,
  pageSize,
  label,
  className,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  label: string;
  className?: string | undefined;
  onPageChange: (page: number) => void;
}) {
  const { copy } = useLanguage();
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) {
    return null;
  }
  const pageLabel = copy.dashboard.booking.pageOf
    .replace('{page}', String(page))
    .replace('{totalPages}', String(pageCount));
  return (
    <nav aria-label={label} className={`${styles.pagination} ${className ?? ''}`}>
      <p className={styles.range} aria-live="polite">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}
      </p>
      <div className={styles.controls}>
        <button
          type="button"
          disabled={page === 1}
          className={styles.button}
          onClick={() => onPageChange(page - 1)}
        >
          {copy.dashboard.booking.previousPage}
        </button>
        <span className={styles.pageCount} aria-current="page" aria-live="polite">
          {pageLabel}
        </span>
        <button
          type="button"
          disabled={page === pageCount}
          className={styles.button}
          onClick={() => onPageChange(page + 1)}
        >
          {copy.dashboard.booking.nextPage}
        </button>
      </div>
    </nav>
  );
}

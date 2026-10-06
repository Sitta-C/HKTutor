'use client';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { notebookButtonClass } from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';

import styles from './notebook-pagination.module.css';

export function NotebookPagination({
  page,
  total,
  pageSize,
  label,
  variant = 'standard',
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  label: string;
  variant?: 'standard' | 'paper-turn';
  onPageChange: (page: number) => void;
}) {
  const { copy } = useLanguage();
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) {
    return null;
  }
  const paperTurn = variant === 'paper-turn';
  const buttonClass = paperTurn
    ? styles.pageTurnButton
    : notebookButtonClass({
        tone: 'secondary',
        className: 'px-3 !text-xs !shadow-none',
      });
  return (
    <nav
      aria-label={label}
      className={
        paperTurn
          ? styles.paperTurn
          : 'mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-paper-edge pt-4'
      }
    >
      <p
        className={paperTurn ? 'sr-only' : 'text-xs tabular-nums text-notebook-muted'}
        aria-live="polite"
      >
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}
      </p>
      <div className={paperTurn ? styles.pageTurnControls : 'flex flex-wrap items-center gap-2'}>
        <button
          type="button"
          disabled={page === 1}
          aria-label={paperTurn ? copy.dashboard.booking.previousPage : undefined}
          className={buttonClass}
          onClick={() => onPageChange(page - 1)}
        >
          {paperTurn ? (
            <DashboardIcon name="arrow-right" className="h-4 w-4 rotate-180" />
          ) : (
            copy.dashboard.booking.previousPage
          )}
        </button>
        <span className={paperTurn ? 'sr-only' : 'text-xs tabular-nums text-notebook-muted'}>
          {copy.dashboard.booking.pageOf
            .replace('{page}', String(page))
            .replace('{totalPages}', String(pageCount))}
        </span>
        <button
          type="button"
          disabled={page === pageCount}
          aria-label={paperTurn ? copy.dashboard.booking.nextPage : undefined}
          className={buttonClass}
          onClick={() => onPageChange(page + 1)}
        >
          {paperTurn ? (
            <DashboardIcon name="arrow-right" className="h-4 w-4" />
          ) : (
            copy.dashboard.booking.nextPage
          )}
        </button>
      </div>
    </nav>
  );
}

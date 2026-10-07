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
  variant?: 'standard' | 'paper-turn' | 'ticket';
  onPageChange: (page: number) => void;
}) {
  const { copy } = useLanguage();
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) {
    return null;
  }
  const paperTurn = variant === 'paper-turn';
  const ticket = variant === 'ticket';
  const buttonClass = paperTurn
    ? styles.pageTurnButton
    : ticket
      ? styles.ticketButton
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
      <div
        className={
          paperTurn
            ? styles.pageTurnControls
            : ticket
              ? styles.ticketControls
              : 'flex flex-wrap items-center gap-2'
        }
      >
        <button
          type="button"
          disabled={page === 1}
          aria-label={paperTurn ? copy.dashboard.booking.previousPage : undefined}
          className={buttonClass}
          data-direction={ticket ? 'previous' : undefined}
          onClick={() => onPageChange(page - 1)}
        >
          {paperTurn ? (
            <DashboardIcon name="arrow-right" className="h-4 w-4 rotate-180" />
          ) : ticket ? (
            <>
              <span className={styles.ticketStub} aria-hidden="true">
                <DashboardIcon name="arrow-right" className="h-4 w-4 rotate-180" />
              </span>
              <span className={styles.ticketLabel}>{copy.dashboard.booking.previousPage}</span>
            </>
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
          data-direction={ticket ? 'next' : undefined}
          onClick={() => onPageChange(page + 1)}
        >
          {paperTurn ? (
            <DashboardIcon name="arrow-right" className="h-4 w-4" />
          ) : ticket ? (
            <>
              <span className={styles.ticketLabel}>{copy.dashboard.booking.nextPage}</span>
              <span className={styles.ticketStub} aria-hidden="true">
                <DashboardIcon name="arrow-right" className="h-4 w-4" />
              </span>
            </>
          ) : (
            copy.dashboard.booking.nextPage
          )}
        </button>
      </div>
    </nav>
  );
}

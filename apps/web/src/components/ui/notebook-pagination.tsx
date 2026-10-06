'use client';

import { notebookButtonClass } from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';

export function NotebookPagination({
  page,
  total,
  pageSize,
  label,
  onPageChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const { copy } = useLanguage();
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) {
    return null;
  }
  const buttonClass = notebookButtonClass({
    tone: 'secondary',
    className: 'px-3 !text-xs !shadow-none',
  });
  return (
    <nav
      aria-label={label}
      className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-paper-edge pt-4"
    >
      <p className="text-xs tabular-nums text-notebook-muted" aria-live="polite">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={page === 1}
          className={buttonClass}
          onClick={() => onPageChange(page - 1)}
        >
          {copy.dashboard.booking.previousPage}
        </button>
        <span className="text-xs tabular-nums text-notebook-muted">
          {copy.dashboard.booking.pageOf
            .replace('{page}', String(page))
            .replace('{totalPages}', String(pageCount))}
        </span>
        <button
          type="button"
          disabled={page === pageCount}
          className={buttonClass}
          onClick={() => onPageChange(page + 1)}
        >
          {copy.dashboard.booking.nextPage}
        </button>
      </div>
    </nav>
  );
}

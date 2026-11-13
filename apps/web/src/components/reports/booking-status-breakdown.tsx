import type { ReportCopy } from '@/components/reports/report-copy';
import type { TutorReportViewModel } from '@/components/reports/report-model';
import type { BookingStatus } from '@/lib/api/types';

const statusStyles: Record<BookingStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-900 before:bg-amber-500',
  CONFIRMED: 'border-blue-200 bg-blue-50 text-blue-900 before:bg-blue-500',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-900 before:bg-emerald-600',
  CANCELED: 'border-red-200 bg-red-50 text-red-900 before:bg-red-500',
  EXPIRED: 'border-stone-300 bg-stone-100 text-stone-800 before:bg-stone-500',
};

export function BookingStatusBreakdown({
  copy,
  report,
}: {
  copy: ReportCopy;
  report: TutorReportViewModel;
}) {
  return (
    <section
      className="mt-5 rounded-2xl border border-paper-edge bg-white/85 p-5 shadow-note sm:p-6"
      aria-labelledby="report-status-title"
    >
      <h2 id="report-status-title" className="text-lg font-bold text-notebook-ink">
        {copy.statusTitle}
      </h2>
      <p className="mt-1 text-sm leading-6 text-notebook-muted">{copy.statusDescription}</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {report.statuses.map((item) => (
          <li
            key={item.status}
            className={`relative flex min-h-20 items-center justify-between gap-3 rounded-xl border px-4 py-3 before:h-2.5 before:w-2.5 before:shrink-0 before:rounded-full ${statusStyles[item.status]}`}
          >
            <span className="min-w-0 flex-1 text-sm font-bold">{item.label}</span>
            <span
              className="text-xl font-black tabular-nums"
              aria-label={`${item.label}: ${item.count}`}
            >
              {item.count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

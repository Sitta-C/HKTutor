import type { ReportCopy } from '@/components/reports/report-copy';
import type { TutorReportViewModel } from '@/components/reports/report-model';
import type { BookingStatus } from '@/lib/api/types';

const statusStyles: Record<BookingStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-800 before:bg-amber-500',
  CONFIRMED: 'border-emerald-200 bg-emerald-50 text-emerald-800 before:bg-emerald-500',
  COMPLETED: 'border-stone-200 bg-stone-100 text-stone-700 before:bg-stone-500',
  CANCELED: 'border-red-200 bg-red-50 text-red-800 before:bg-red-500',
  EXPIRED: 'border-red-200 bg-red-50 text-red-800 before:bg-red-500',
};

export function BookingStatusBreakdown({
  copy,
  headingLevel = 'h2',
  report,
}: {
  copy: ReportCopy;
  headingLevel?: 'h2' | 'h4';
  report: TutorReportViewModel;
}) {
  const Heading = headingLevel;
  return (
    <section
      className="mt-5 rounded-2xl border border-paper-edge bg-white/85 p-5 sm:p-6"
      aria-labelledby="report-status-title"
    >
      <Heading id="report-status-title" className="text-lg font-bold text-notebook-ink">
        {copy.statusTitle}
      </Heading>
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

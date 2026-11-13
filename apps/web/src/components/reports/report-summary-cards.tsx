import type { ReportCopy } from '@/components/reports/report-copy';
import type { TutorReportViewModel } from '@/components/reports/report-model';

export function ReportSummaryCards({
  copy,
  report,
}: {
  copy: ReportCopy;
  report: TutorReportViewModel;
}) {
  const cards = [
    {
      label: copy.totalBookings,
      value: report.totalBookings,
      explanation: null,
    },
    {
      label: copy.revenue,
      value: report.revenue,
      explanation: copy.revenueExplanation,
    },
    {
      label: copy.completionRate,
      value: report.completionRate,
      explanation: copy.completionExplanation,
    },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={copy.title}>
      {cards.map((card) => (
        <div
          key={card.label}
          className="min-w-0 rounded-2xl border border-paper-edge bg-white p-5"
        >
          <dt className="text-sm font-bold leading-6 text-notebook-muted-deep">{card.label}</dt>
          <dd className="mt-3 break-words text-2xl font-black tabular-nums text-notebook-ink sm:text-3xl">
            {card.value}
          </dd>
          {card.explanation && (
            <p className="mt-3 text-xs leading-5 text-notebook-muted">{card.explanation}</p>
          )}
        </div>
      ))}
    </dl>
  );
}

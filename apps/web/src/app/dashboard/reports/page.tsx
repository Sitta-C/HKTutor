import TutorReportPage from '@/components/reports/tutor-report-page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tutor report | HKTutor',
  description: 'Private all-time tutor booking and paid completed revenue report.',
  robots: { index: false, follow: false },
};

export default function DashboardReportsPage() {
  return <TutorReportPage />;
}

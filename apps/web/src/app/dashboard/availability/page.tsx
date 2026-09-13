import TutorAvailabilityPage from '@/components/availability/tutor-availability-page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tutor availability',
  description: 'Manage future tutor availability in Bangkok time.',
  robots: { index: false, follow: false },
};

export default function DashboardAvailabilityPage() {
  return <TutorAvailabilityPage />;
}

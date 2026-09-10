import TutorListingsPage from '@/components/listings/tutor-listings-page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My teaching listings',
  description: 'Create, review, and manage your HKTutor teaching listings.',
  robots: { index: false, follow: false },
};

export default function DashboardListingsPage() {
  return <TutorListingsPage />;
}

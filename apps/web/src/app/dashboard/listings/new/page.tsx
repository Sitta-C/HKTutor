import TutorListingEditor from '@/components/listings/tutor-listing-editor';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create teaching listing',
  description: 'Create a clear teaching offer for HKTutor students.',
  robots: { index: false, follow: false },
};

export default function NewTutorListingPage() {
  return <TutorListingEditor />;
}

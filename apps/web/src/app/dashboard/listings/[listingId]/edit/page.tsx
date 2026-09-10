import TutorListingEditor from '@/components/listings/tutor-listing-editor';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Edit teaching listing',
  description: 'Update your HKTutor teaching listing and publication status.',
  robots: { index: false, follow: false },
};

export default async function EditTutorListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  return <TutorListingEditor listingId={listingId} />;
}

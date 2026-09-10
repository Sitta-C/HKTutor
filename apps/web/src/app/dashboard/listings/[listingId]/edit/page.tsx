import TutorListingEditor from '@/components/listings/tutor-listing-editor';

export default async function EditTutorListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  return <TutorListingEditor listingId={listingId} />;
}

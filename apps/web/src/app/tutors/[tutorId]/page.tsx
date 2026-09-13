import { Suspense } from 'react';

import PublicTutorSearchShell from '@/components/tutors/public-tutor-search-shell';
import PublicTutorAvailabilityPage, {
  PublicTutorAvailabilityLoading,
} from '@/components/tutors/tutor-availability-page';

export default async function PublicTutorDetailRoute({
  params,
}: {
  params: Promise<{ tutorId: string }>;
}) {
  const { tutorId } = await params;

  return (
    <Suspense fallback={<PublicTutorAvailabilityLoading />}>
      <PublicTutorSearchShell>
        <PublicTutorAvailabilityPage tutorId={tutorId} />
      </PublicTutorSearchShell>
    </Suspense>
  );
}

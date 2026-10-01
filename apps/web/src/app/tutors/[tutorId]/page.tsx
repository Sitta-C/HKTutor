import { Suspense } from 'react';

import PublicTutorAvailabilityPage, {
  PublicTutorAvailabilityLoading,
} from '@/components/tutors/public-tutor-availability';
import PublicTutorSearchShell from '@/components/tutors/public-tutor-search-shell';

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

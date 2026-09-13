import { Suspense } from 'react';

import PublicTutorSearchShell from '@/components/tutors/public-tutor-search-shell';
import TutorAvailabilityPage from '@/components/tutors/tutor-availability-page';

export default async function PublicTutorDetailRoute({
  params,
}: {
  params: Promise<{ tutorId: string }>;
}) {
  const { tutorId } = await params;

  return (
    <Suspense fallback={<p className="p-6 text-sm font-semibold">Loading tutor…</p>}>
      <PublicTutorSearchShell>
        <TutorAvailabilityPage tutorId={tutorId} />
      </PublicTutorSearchShell>
    </Suspense>
  );
}

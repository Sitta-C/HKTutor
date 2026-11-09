import PublicTutorSearchShell from '@/components/tutors/public-tutor-search-shell';
import TutorSearchPage from '@/components/tutors/tutor-search-page';

export const metadata = {
  title: 'Find a tutor',
  description: 'Search published listings from verified HKTutor tutors.',
};

export default async function TutorsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { comparisonSort } = await searchParams;
  return (
    <PublicTutorSearchShell>
      <TutorSearchPage comparisonSort={comparisonSort} />
    </PublicTutorSearchShell>
  );
}

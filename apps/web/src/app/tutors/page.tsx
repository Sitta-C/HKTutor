import PublicTutorSearchShell from '@/components/tutors/public-tutor-search-shell';
import TutorSearchPage from '@/components/tutors/tutor-search-page';

export const metadata = {
  title: 'Find a tutor',
  description: 'Search published listings from verified HKTutor tutors.',
};

export default function TutorsPage() {
  return (
    <PublicTutorSearchShell>
      <TutorSearchPage />
    </PublicTutorSearchShell>
  );
}

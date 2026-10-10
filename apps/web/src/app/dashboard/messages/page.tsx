import { Suspense } from 'react';

import MessagesPage from '@/components/conversations/messages-page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Messages | HKTutor',
  description: 'Private student and tutor conversations.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense>
      <MessagesPage />
    </Suspense>
  );
}

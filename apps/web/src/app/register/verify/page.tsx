import Verify from '@/components/verify';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Verify email',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function VerifyPage() {
  return <Verify />;
}

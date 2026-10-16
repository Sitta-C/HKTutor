import { Suspense } from 'react';

import PasswordRecovery from '@/components/auth/password-recovery';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PasswordRecoveryPage() {
  return (
    <Suspense fallback={null}>
      <PasswordRecovery mode="request" />
    </Suspense>
  );
}

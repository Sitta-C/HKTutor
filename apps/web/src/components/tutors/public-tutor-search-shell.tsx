'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';
import type { ReactNode } from 'react';

const visualDemoUser: AuthUser = {
  id: 'public-search-demo-user',
  email: 'student@example.com',
  role: 'STUDENT',
  displayName: 'Somchai',
};

export default function PublicTutorSearchShell({ children }: { children: ReactNode }) {
  const { copy } = useLanguage();
  const router = useRouter();

  return (
    <DashboardShell
      user={visualDemoUser}
      onLogout={async () => {
        router.push('/');
      }}
      headerNavRight={
        <>
          <Link href="#bookings">{copy.dashboard.header.myBookingsNav}</Link>
          <Link href="#tutor-search-filters" className="dash-cta">
            {copy.dashboard.header.findTutorCta}
          </Link>
        </>
      }
    >
      {children}
    </DashboardShell>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookPage, StickyNote, WashiTape } from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';
import { useProfileSession } from '@/lib/use-profile-session';

import type { AuthUser } from '@/lib/api/types';
import type { ReactNode } from 'react';

const publicGuestUser: AuthUser = {
  id: 'public-search-guest',
  email: '',
  role: 'STUDENT',
  displayName: 'Guest',
};

export default function PublicTutorSearchShell({ children }: { children: ReactNode }) {
  const { isLoading, logout, profileUser, user } = useProfileSession({
    allowGuest: true,
    profileMode: 'optional',
  });
  const { copy } = useLanguage();
  const router = useRouter();

  if (isLoading) {
    return (
      <NotebookPage className="flex min-h-dvh items-center justify-center p-6">
        <StickyNote
          tone="green"
          className="relative min-w-64 p-6 text-center text-sm font-semibold"
          role="status"
          aria-live="polite"
        >
          <WashiTape className="-top-2 left-1/2 -translate-x-1/2" />
          {copy.dashboard.common.loading}
        </StickyNote>
      </NotebookPage>
    );
  }

  const shellUser = profileUser ?? publicGuestUser;

  return (
    <DashboardShell
      user={shellUser}
      onLogout={async () => {
        if (user) await logout();
        router.push('/');
      }}
      showSignOut={Boolean(user)}
      headerNavRight={
        <>
          <Link href="/dashboard/bookings">{copy.dashboard.header.myBookingsNav}</Link>
          <Link href="/tutors" data-dashboard-action>
            {copy.dashboard.header.findTutorCta}
          </Link>
        </>
      }
    >
      {children}
    </DashboardShell>
  );
}

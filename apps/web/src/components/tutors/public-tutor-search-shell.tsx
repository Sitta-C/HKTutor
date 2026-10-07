'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { tutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import { NotebookLoading } from '@/components/ui/notebook-loading';
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
  const { copy, language } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();

  if (isLoading) {
    return (
      <NotebookLoading
        kind={pathname.startsWith('/tutors/') ? 'tutorDetailSession' : 'tutorSearchSession'}
        label={
          pathname.startsWith('/tutors/')
            ? copy.dashboard.tutorAvailability.loading
            : tutorSearchCopy[language].loading
        }
      />
    );
  }

  const shellUser = profileUser ?? publicGuestUser;
  const isSearchPage = pathname === '/tutors';

  return (
    <DashboardShell
      user={shellUser}
      avatarEnabled={Boolean(user)}
      onLogout={async () => {
        if (user) await logout();
        router.push('/');
      }}
      showSignOut={Boolean(user)}
      navBadges={{ bookings: '—' }}
      headerNavRight={
        isSearchPage && !user ? (
          <Link href="/" data-dashboard-action>
            {tutorSearchCopy[language].signIn}
          </Link>
        ) : null
      }
    >
      {children}
    </DashboardShell>
  );
}

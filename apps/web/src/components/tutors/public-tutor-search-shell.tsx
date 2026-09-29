'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookPage, StickyNote, WashiTape } from '@/components/ui/notebook';
import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';
import type { ReactNode } from 'react';

const publicGuestUser: AuthUser = {
  id: 'public-search-guest',
  email: '',
  role: 'STUDENT',
  displayName: 'Guest',
};

export default function PublicTutorSearchShell({ children }: { children: ReactNode }) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { copy } = useLanguage();
  const router = useRouter();
  const [profileUser, setProfileUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;

    let active = true;
    getMyProfile()
      .then((result) => {
        if (!active) return;
        const displayName =
          result.role === 'STUDENT'
            ? result.profile && 'school' in result.profile
              ? result.profile.nickname
              : undefined
            : result.role === 'TUTOR'
              ? result.profile && 'displayName' in result.profile
                ? result.profile.displayName
                : undefined
              : undefined;
        setProfileUser(displayName ? { ...user, displayName } : { ...user });
      })
      .catch(() => {
        if (active) setProfileUser(user);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const profileReady = !user || profileUser?.id === user.id;
  if (authLoading || (user && !profileReady)) {
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

  const shellUser = (user && profileReady ? profileUser : null) ?? user ?? publicGuestUser;

  return (
    <DashboardShell
      user={shellUser}
      onLogout={async () => {
        if (user) await logout();
        router.push('/');
      }}
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

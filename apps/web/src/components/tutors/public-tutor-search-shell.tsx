'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
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
      <div
        className="flex min-h-dvh items-center justify-center bg-[#fbfaf7] p-6 text-sm font-semibold text-[#5e5a52]"
        role="status"
        aria-live="polite"
      >
        {copy.dashboard.common.loading}
      </div>
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

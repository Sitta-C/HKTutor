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

export default function StudentBookingShell({ children }: { children: ReactNode }) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { copy } = useLanguage();
  const router = useRouter();
  const [profileUser, setProfileUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/');
      return;
    }
    if (user.role !== 'STUDENT') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    getMyProfile()
      .then((result) => {
        if (!active) return;
        const nickname =
          result.profile && 'school' in result.profile ? result.profile.nickname.trim() : '';
        setProfileUser(nickname ? { ...user, displayName: nickname } : { ...user });
      })
      .catch(() => {
        if (active) setProfileUser(user);
      });

    return () => {
      active = false;
    };
  }, [authLoading, router, user]);

  if (authLoading || !user || (user.role === 'STUDENT' && !profileUser)) {
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

  if (user.role !== 'STUDENT') return null;

  return (
    <DashboardShell
      user={profileUser ?? user}
      onLogout={async () => {
        await logout();
        router.replace('/');
      }}
      headerNavRight={
        <>
          <Link href="/dashboard/bookings">{copy.dashboard.header.myBookingsNav}</Link>
          <Link href="/tutors" className="dash-cta">
            {copy.dashboard.header.findTutorCta}
          </Link>
        </>
      }
    >
      {children}
    </DashboardShell>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import AdminDashboard from '@/components/dashboard/admin-dashboard';
import StudentDashboard from '@/components/dashboard/student-dashboard';
import TutorDashboard from '@/components/dashboard/tutor-dashboard';
import { ApiError } from '@/lib/api/error';
import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';

export default function DashboardPage() {
  const { isLoading, logout, user } = useAuth();
  const { copy } = useLanguage();
  const router = useRouter();
  const [profileUser, setProfileUser] = useState<AuthUser | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;

    getMyProfile()
      .then((result) => {
        if (!active) return;
        if (!result.profileComplete || !result.consentCurrent) {
          router.replace('/onboarding/profile');
          return;
        }

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
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 400) {
          router.replace('/onboarding/profile');
          return;
        }
        setProfileError(error instanceof Error ? error.message : 'Unable to load profile');
      });

    return () => {
      active = false;
    };
  }, [router, user]);

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  // Prevent flashing content or incorrect role during session loading or when unauthenticated
  if (isLoading || !user) {
    return (
      <div className="dash-root">
        <div className="dash-art" aria-hidden="true">
          <div className="blob dash-b1" />
          <div className="blob dash-b2" />
        </div>
        <div
          role="status"
          aria-live="polite"
          className="relative z-10 flex min-h-dvh flex-col items-center justify-center p-6 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#1a1916] border-t-transparent" />
          </div>
          <p className="mt-4 text-sm font-semibold text-[#5e5a52]">
            {copy.dashboard.common.loading}
          </p>
        </div>
      </div>
    );
  }

  if (!profileUser && !profileError) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh items-center justify-center bg-[#fbfaf7] p-6 text-sm font-semibold text-[#5e5a52]"
      >
        {copy.dashboard.common.loading}
      </div>
    );
  }

  if (profileError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#fbfaf7] p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-[#171714]">Unable to load profile</h1>
          <p className="mt-3 text-sm text-[#c04f40]" role="alert">
            {profileError}
          </p>
        </div>
      </main>
    );
  }

  if (!profileUser) return null;

  // Strictly use authenticated API role from AuthContext
  if (user.role === 'STUDENT') {
    return <StudentDashboard user={profileUser} onLogout={handleLogout} />;
  }

  if (user.role === 'TUTOR') {
    return <TutorDashboard user={profileUser} onLogout={handleLogout} />;
  }

  // Explicit safe ADMIN state and unsupported fallback (never student or tutor)
  return <AdminDashboard user={profileUser} onLogout={handleLogout} />;
}

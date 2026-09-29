'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import AdminDashboard from '@/components/dashboard/admin-dashboard';
import StudentDashboard from '@/components/dashboard/student-dashboard';
import TutorDashboard from '@/components/dashboard/tutor-dashboard';
import { NotebookPage, StickyNote, WashiTape } from '@/components/ui/notebook';
import { ApiError } from '@/lib/api/error';
import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';
import { requiresPrivateProfile, resolveDashboardGate } from '@/lib/profile-navigation';

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
    if (!requiresPrivateProfile(user.role)) return;

    let active = true;

    getMyProfile()
      .then((result) => {
        if (!active) return;
        const gate = resolveDashboardGate(result);
        if (gate) {
          router.replace(gate);
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
      <NotebookPage className="relative flex items-center justify-center overflow-hidden p-6">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rotate-6 rounded-3xl bg-sticky-blue/45"
          aria-hidden="true"
        />
        <div role="status" aria-live="polite" className="relative z-10 text-center">
          <StickyNote tone="yellow" className="min-w-56 px-8 py-7">
            <WashiTape className="-top-2 left-1/2 -translate-x-1/2" />
            <span className="mx-auto block h-7 w-7 animate-spin rounded-full border-2 border-notebook-ink border-t-transparent" />
            <p className="mt-4 font-note text-xl font-semibold text-notebook-ink">
              {copy.dashboard.common.loading}
            </p>
          </StickyNote>
        </div>
      </NotebookPage>
    );
  }

  const privateProfileRequired = requiresPrivateProfile(user.role);

  if (privateProfileRequired && !profileUser && !profileError) {
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

  if (privateProfileRequired && profileError) {
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

  const dashboardUser = privateProfileRequired ? profileUser : user;
  if (!dashboardUser) return null;

  // Strictly use authenticated API role from AuthContext
  if (user.role === 'STUDENT') {
    return <StudentDashboard user={dashboardUser} onLogout={handleLogout} />;
  }

  if (user.role === 'TUTOR') {
    return <TutorDashboard user={dashboardUser} onLogout={handleLogout} />;
  }

  // Explicit safe ADMIN state and unsupported fallback (never student or tutor)
  return <AdminDashboard user={dashboardUser} onLogout={handleLogout} />;
}

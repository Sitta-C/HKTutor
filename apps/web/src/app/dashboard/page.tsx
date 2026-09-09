'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import AdminDashboard from '@/components/dashboard/admin-dashboard';
import StudentDashboard from '@/components/dashboard/student-dashboard';
import TutorDashboard from '@/components/dashboard/tutor-dashboard';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

export default function DashboardPage() {
  const { isLoading, logout, user } = useAuth();
  const { copy } = useLanguage();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/');
    }
  }, [isLoading, router, user]);

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

  // Strictly use authenticated API role from AuthContext
  if (user.role === 'STUDENT') {
    return <StudentDashboard user={user} onLogout={handleLogout} />;
  }

  if (user.role === 'TUTOR') {
    return <TutorDashboard user={user} onLogout={handleLogout} />;
  }

  // Explicit safe ADMIN state and unsupported fallback (never student or tutor)
  return <AdminDashboard user={user} onLogout={handleLogout} />;
}

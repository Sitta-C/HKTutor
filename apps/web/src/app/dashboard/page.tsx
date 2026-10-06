'use client';

import { useRouter } from 'next/navigation';

import AdminDashboard from '@/components/dashboard/admin-dashboard';
import { DashboardLoading } from '@/components/dashboard/dashboard-loading';
import StudentDashboard from '@/components/dashboard/student-dashboard';
import TutorDashboard from '@/components/dashboard/tutor-dashboard';
import { useLanguage } from '@/lib/i18n';
import { useProfileSession } from '@/lib/use-profile-session';

export default function DashboardPage() {
  const { isLoading, logout, profileError, profileUser, user } = useProfileSession({
    profileMode: 'required',
    profileErrorMode: 'report',
  });
  const { copy } = useLanguage();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  // Prevent flashing content or incorrect role during session loading or when unauthenticated
  if (isLoading || !user) {
    return <DashboardLoading />;
  }

  if (profileError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#fbfaf7] p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-[#171714]">
            {copy.dashboard.common.loadProfileError}
          </h1>
          <p className="mt-3 text-sm text-[#c04f40]" role="alert">
            {profileError}
          </p>
        </div>
      </main>
    );
  }

  const dashboardUser = profileUser ?? user;

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

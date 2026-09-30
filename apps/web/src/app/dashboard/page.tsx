'use client';

import { useRouter } from 'next/navigation';

import AdminDashboard from '@/components/dashboard/admin-dashboard';
import StudentDashboard from '@/components/dashboard/student-dashboard';
import TutorDashboard from '@/components/dashboard/tutor-dashboard';
import { NotebookPage, StickyNote, WashiTape } from '@/components/ui/notebook';
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

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookLoading } from '@/components/ui/notebook-loading';
import { useLanguage } from '@/lib/i18n';
import { useProfileSession } from '@/lib/use-profile-session';

import type { ReactNode } from 'react';

/**
 * Both participants can open classroom details; creation and confirmation remain student-only.
 */
const BOOKINGS_INBOX_PATH = '/dashboard/bookings';

export default function BookingWorkspaceShell({ children }: { children: ReactNode }) {
  const { isLoading, logout, profileUser, user } = useProfileSession({
    preserveReturnTo: true,
    profileMode: 'required',
  });
  const { copy } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const role = user?.role;
  const isInboxRoute = pathname === BOOKINGS_INBOX_PATH;
  const isClassDetailsRoute =
    /^\/dashboard\/bookings\/[^/]+$/.test(pathname) && pathname !== `${BOOKINGS_INBOX_PATH}/new`;
  const tutorOnStudentRoute = role === 'TUTOR' && !isInboxRoute && !isClassDetailsRoute;
  const roleAllowed = role === 'STUDENT' || role === 'TUTOR';

  useEffect(() => {
    if (isLoading || !role) return;
    if (!roleAllowed) {
      router.replace('/dashboard');
      return;
    }
    if (tutorOnStudentRoute) router.replace(BOOKINGS_INBOX_PATH);
  }, [isLoading, role, roleAllowed, router, tutorOnStudentRoute]);

  if (isLoading || !user) {
    // The role is still unknown here, so the label stays role-neutral for both inbox and list.
    return (
      <NotebookLoading
        kind={
          pathname === '/dashboard/bookings/new'
            ? 'bookingConfirmSession'
            : pathname.startsWith('/dashboard/bookings/')
              ? 'bookingDetailSession'
              : 'bookingsSession'
        }
        label={copy.dashboard.booking.loading}
      />
    );
  }

  if (!roleAllowed || tutorOnStudentRoute) return null;

  return (
    <DashboardShell
      user={profileUser ?? user}
      onLogout={async () => {
        await logout();
        router.replace('/');
      }}
    >
      {children}
    </DashboardShell>
  );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookPage, StickyNote, WashiTape } from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';
import { useProfileSession } from '@/lib/use-profile-session';

import type { ReactNode } from 'react';

export default function StudentBookingShell({ children }: { children: ReactNode }) {
  const { isLoading, logout, profileUser, user } = useProfileSession({
    preserveReturnTo: true,
    profileMode: 'required',
    requiredRole: 'STUDENT',
  });
  const { copy } = useLanguage();
  const router = useRouter();

  if (isLoading || !user) {
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

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookLoading } from '@/components/ui/notebook-loading';
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
  const pathname = usePathname();

  if (isLoading || !user) {
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

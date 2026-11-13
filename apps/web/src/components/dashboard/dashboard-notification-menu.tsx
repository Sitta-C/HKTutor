'use client';

import { usePathname } from 'next/navigation';

import { NotificationInbox } from '@/components/notifications/notification-inbox';
import { useAuth } from '@/lib/auth-context';

export function DashboardNotificationMenu() {
  const { user } = useAuth();
  const pathname = usePathname();
  return user && (user.role === 'STUDENT' || user.role === 'TUTOR') ? (
    <NotificationInbox
      key={`${user.id}:${user.role}:${pathname}`}
      role={user.role}
      userId={user.id}
    />
  ) : null;
}

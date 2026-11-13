'use client';

import { usePathname } from 'next/navigation';

import { NotificationInbox } from '@/components/notifications/notification-inbox';
import { useNotificationInbox } from '@/components/notifications/use-notification-inbox';
import { useAuth } from '@/lib/auth-context';

export function DashboardNotificationMenu() {
  const { user } = useAuth();
  return user && (user.role === 'STUDENT' || user.role === 'TUTOR') ? (
    <UserNotificationMenu key={`${user.id}:${user.role}`} role={user.role} userId={user.id} />
  ) : null;
}

function UserNotificationMenu({ role, userId }: { role: 'STUDENT' | 'TUTOR'; userId: string }) {
  const pathname = usePathname();
  const inbox = useNotificationInbox(userId);
  // Only the dropdown resets on navigation. Filters, loaded history and receipt writes survive.
  return <NotificationInbox key={pathname} role={role} inbox={inbox} />;
}

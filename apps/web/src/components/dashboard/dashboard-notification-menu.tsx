'use client';

import { NotificationInbox } from '@/components/notifications/notification-inbox';
import { useAuth } from '@/lib/auth-context';

export function DashboardNotificationMenu() {
  const { user } = useAuth();
  return user && (user.role === 'STUDENT' || user.role === 'TUTOR') ? (
    <NotificationInbox key={`${user.id}:${user.role}`} role={user.role} />
  ) : null;
}

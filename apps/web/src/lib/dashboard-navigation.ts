import type { DashboardIconName } from '@/components/dashboard/dashboard-icon';
import type { AuthUser, UserRole } from '@/lib/api/types';
import type { Translation } from '@/lib/i18n';

export type DashboardViewType = 'student' | 'tutor' | 'admin';

export interface DashboardNavItem {
  id: string;
  href: string;
  icon: DashboardIconName;
  label: string;
  badge?: string;
  isDanger?: boolean;
}

/**
 * Resolves the view type strictly from the authenticated user role.
 * Never falls through to Student or Tutor on unknown or Admin roles.
 */
export function resolveDashboardView(role: UserRole): DashboardViewType {
  if (role === 'STUDENT') return 'student';
  if (role === 'TUTOR') return 'tutor';
  if (role === 'ADMIN') return 'admin';
  return 'admin';
}

export function getDashboardNavItems(role: UserRole, copy: Translation): DashboardNavItem[] {
  const navCopy = copy.dashboard.nav;

  if (role === 'STUDENT') {
    return [
      {
        id: 'dashboard',
        href: '/dashboard',
        icon: 'dashboard',
        label: copy.dashboard.common.eyebrow,
      },
      {
        id: 'profile',
        href: '/dashboard/profile',
        icon: 'profile',
        label: navCopy.myProfile,
      },
      {
        id: 'bookings',
        href: '/dashboard/bookings',
        icon: 'bookings',
        label: navCopy.myBookings,
        badge: '0',
      },
      {
        id: 'settings',
        href: '#settings',
        icon: 'settings',
        label: navCopy.settings,
      },
      {
        id: 'support',
        href: '#support',
        icon: 'support',
        label: navCopy.support,
      },
      {
        id: 'privacy',
        href: '#privacy',
        icon: 'shield',
        label: navCopy.privacy,
      },
      {
        id: 'signout',
        href: '#signout',
        icon: 'logout',
        label: navCopy.signOut,
        isDanger: true,
      },
    ];
  }

  if (role === 'TUTOR') {
    return [
      {
        id: 'dashboard',
        href: '/dashboard',
        icon: 'dashboard',
        label: copy.dashboard.common.eyebrow,
      },
      {
        id: 'profile',
        href: '/dashboard/profile',
        icon: 'profile',
        label: navCopy.myProfile,
      },
      {
        id: 'listings',
        href: '/dashboard/listings',
        icon: 'listings',
        label: navCopy.myListings,
      },
      {
        id: 'availability',
        href: '/dashboard/availability',
        icon: 'availability',
        label: navCopy.availability,
      },
      {
        id: 'settings',
        href: '#settings',
        icon: 'settings',
        label: navCopy.settings,
      },
      {
        id: 'support',
        href: '#support',
        icon: 'support',
        label: navCopy.support,
      },
      {
        id: 'privacy',
        href: '#privacy',
        icon: 'shield',
        label: navCopy.privacy,
      },
      {
        id: 'signout',
        href: '#signout',
        icon: 'logout',
        label: navCopy.signOut,
        isDanger: true,
      },
    ];
  }

  // Explicit safe ADMIN navigation: no student or tutor items
  return [
    {
      id: 'dashboard',
      href: '/dashboard',
      icon: 'dashboard',
      label: copy.dashboard.common.eyebrow,
    },
    {
      id: 'privacy',
      href: '#privacy',
      icon: 'shield',
      label: navCopy.privacy,
    },
    {
      id: 'signout',
      href: '#signout',
      icon: 'logout',
      label: navCopy.signOut,
      isDanger: true,
    },
  ];
}

export function getUserDisplayName(user: Pick<AuthUser, 'email' | 'displayName'>): string {
  if (user.displayName?.trim()) return user.displayName.trim();
  const prefix = user.email.split('@')[0] ?? 'User';
  if (!prefix) return 'User';
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export function getUserInitial(user: Pick<AuthUser, 'email' | 'displayName'>): string {
  return (user.displayName?.charAt(0) || user.email.charAt(0) || 'U').toUpperCase();
}

export function isDashboardNavActive(itemId: string, pathname: string): boolean {
  if (itemId === 'dashboard') return pathname === '/dashboard';
  if (itemId === 'profile') return pathname === '/dashboard/profile';
  if (itemId === 'bookings') return pathname.startsWith('/dashboard/bookings');
  if (itemId === 'listings') return pathname.startsWith('/dashboard/listings');
  if (itemId === 'availability') return pathname.startsWith('/dashboard/availability');
  return false;
}

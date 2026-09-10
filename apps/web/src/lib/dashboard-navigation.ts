import type { AuthUser, UserRole } from '@/lib/api/types';
import type { Translation } from '@/lib/i18n';

export type DashboardViewType = 'student' | 'tutor' | 'admin';

export interface DashboardNavItem {
  id: string;
  href: string;
  icon: string;
  label: string;
  badge?: string;
  isDanger?: boolean;
}

export interface RoleThemeConfig {
  role: UserRole;
  viewType: DashboardViewType;
  accentColor: string;
  accentDeepColor: string;
  softBg: string;
  gradientFrom: string;
  gradientTo: string;
  roleChipText: string;
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

export function getDashboardRoleConfig(role: UserRole, copy: Translation): RoleThemeConfig {
  switch (role) {
    case 'STUDENT':
      return {
        role: 'STUDENT',
        viewType: 'student',
        accentColor: '#22c49a',
        accentDeepColor: '#0e8a73',
        softBg: 'rgba(34, 196, 154, 0.14)',
        gradientFrom: '#3fd8b3',
        gradientTo: '#0c9a7c',
        roleChipText: copy.dashboard.common.studentChip,
      };
    case 'TUTOR':
      return {
        role: 'TUTOR',
        viewType: 'tutor',
        accentColor: '#0e8eea',
        accentDeepColor: '#0b6db0',
        softBg: 'rgba(14, 142, 234, 0.14)',
        gradientFrom: '#4ab4f5',
        gradientTo: '#0a6fbc',
        roleChipText: copy.dashboard.common.tutorChip,
      };
    case 'ADMIN':
    default:
      return {
        role: 'ADMIN',
        viewType: 'admin',
        accentColor: '#d18b43',
        accentDeepColor: '#b26f28',
        softBg: 'rgba(209, 139, 67, 0.14)',
        gradientFrom: '#ffc57d',
        gradientTo: '#f0a04e',
        roleChipText: copy.dashboard.common.adminChip,
      };
  }
}

export function getDashboardNavItems(role: UserRole, copy: Translation): DashboardNavItem[] {
  const navCopy = copy.dashboard.nav;

  if (role === 'STUDENT') {
    return [
      {
        id: 'profile',
        href: '/dashboard/profile',
        icon: 'profile',
        label: navCopy.myProfile,
      },
      {
        id: 'bookings',
        href: '#bookings',
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
        icon: 'privacy',
        label: navCopy.privacy,
      },
      {
        id: 'signout',
        href: '#signout',
        icon: 'signout',
        label: navCopy.signOut,
        isDanger: true,
      },
    ];
  }

  if (role === 'TUTOR') {
    return [
      {
        id: 'profile',
        href: '/dashboard/profile',
        icon: 'profile',
        label: navCopy.myProfile,
      },
      {
        id: 'listings',
        href: '#listings',
        icon: 'listings',
        label: navCopy.myListings,
        badge: '0',
      },
      {
        id: 'availability',
        href: '#availability',
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
        icon: 'privacy',
        label: navCopy.privacy,
      },
      {
        id: 'signout',
        href: '#signout',
        icon: 'signout',
        label: navCopy.signOut,
        isDanger: true,
      },
    ];
  }

  // Explicit safe ADMIN navigation: no student or tutor items
  return [
    {
      id: 'privacy',
      href: '#privacy',
      icon: 'privacy',
      label: navCopy.privacy,
    },
    {
      id: 'signout',
      href: '#signout',
      icon: 'signout',
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

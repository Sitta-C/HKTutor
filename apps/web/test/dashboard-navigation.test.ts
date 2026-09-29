import { describe, expect, it } from 'vitest';

import {
  getDashboardNavItems,
  getUserInitial,
  isDashboardNavActive,
  resolveDashboardView,
} from '@/lib/dashboard-navigation';
import { translations } from '@/lib/i18n';

describe('dashboard role navigation', () => {
  it('maps authenticated roles to their own shell theme', () => {
    expect(resolveDashboardView('STUDENT')).toBe('student');
    expect(resolveDashboardView('TUTOR')).toBe('tutor');
    expect(resolveDashboardView('ADMIN')).toBe('admin');
  });

  it('marks exact dashboard and profile routes active', () => {
    expect(isDashboardNavActive('dashboard', '/dashboard')).toBe(true);
    expect(isDashboardNavActive('dashboard', '/dashboard/bookings')).toBe(false);
    expect(isDashboardNavActive('profile', '/dashboard/profile')).toBe(true);
    expect(isDashboardNavActive('profile', '/dashboard/profile/edit')).toBe(false);
  });

  it('keeps nested workspace routes under their matching navigation item', () => {
    expect(isDashboardNavActive('bookings', '/dashboard/bookings/booking-1')).toBe(true);
    expect(isDashboardNavActive('listings', '/dashboard/listings/new')).toBe(true);
    expect(isDashboardNavActive('availability', '/dashboard/availability')).toBe(true);
    expect(isDashboardNavActive('support', '/dashboard')).toBe(false);
  });

  it('only exposes implemented navigation destinations', () => {
    expect(getDashboardNavItems('STUDENT', translations.en).map((item) => item.id)).toEqual([
      'dashboard',
      'profile',
      'bookings',
      'privacy',
    ]);
    expect(getDashboardNavItems('TUTOR', translations.en).map((item) => item.id)).toEqual([
      'dashboard',
      'profile',
      'listings',
      'availability',
      'privacy',
    ]);
    expect(getDashboardNavItems('ADMIN', translations.en).map((item) => item.id)).toEqual([
      'dashboard',
      'privacy',
    ]);
  });

  it('uses up to two name initials for the avatar fallback', () => {
    expect(getUserInitial({ displayName: 'Mali Sukjai', email: 'mali@example.test' })).toBe('MS');
    expect(getUserInitial({ email: 'anan@example.test' })).toBe('A');
  });
});

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
    expect(isDashboardNavActive('messages', '/dashboard/messages')).toBe(true);
    expect(isDashboardNavActive('messages', '/dashboard/messages-extra')).toBe(false);
  });

  it('only exposes implemented navigation destinations', () => {
    expect(getDashboardNavItems('STUDENT', translations.en).map((item) => item.id)).toEqual([
      'dashboard',
      'profile',
      'bookings',
      'messages',
      'privacy',
    ]);
    expect(getDashboardNavItems('TUTOR', translations.en).map((item) => item.id)).toEqual([
      'dashboard',
      'profile',
      'bookings',
      'listings',
      'availability',
      'messages',
      'privacy',
    ]);
    expect(getDashboardNavItems('ADMIN', translations.en).map((item) => item.id)).toEqual([
      'dashboard',
      'privacy',
    ]);
  });

  it('sends both roles to the shared booking workspace under their own label', () => {
    const studentBookings = getDashboardNavItems('STUDENT', translations.en).find(
      (item) => item.id === 'bookings',
    );
    const tutorBookings = getDashboardNavItems('TUTOR', translations.en).find(
      (item) => item.id === 'bookings',
    );

    expect(studentBookings?.href).toBe('/dashboard/bookings');
    expect(tutorBookings?.href).toBe('/dashboard/bookings');
    expect(studentBookings?.label).toBe(translations.en.dashboard.nav.myBookings);
    expect(tutorBookings?.label).toBe(translations.en.dashboard.nav.bookingRequests);
  });

  it('uses up to two name initials for the avatar fallback', () => {
    expect(getUserInitial({ displayName: 'Mali Sukjai', email: 'mali@example.test' })).toBe('MS');
    expect(getUserInitial({ email: 'anan@example.test' })).toBe('A');
  });
});

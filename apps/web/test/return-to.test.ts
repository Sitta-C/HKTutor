import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTH_RETURN_TO, sanitizeReturnTo, withReturnTo } from '@/lib/return-to';

describe('authentication return paths', () => {
  it('preserves a local path with query parameters and a fragment', () => {
    expect(sanitizeReturnTo('/tutors/tutor-1?listingId=listing-1#times')).toBe(
      '/tutors/tutor-1?listingId=listing-1#times',
    );
  });

  it.each([
    undefined,
    null,
    '',
    'dashboard',
    'https://attacker.example/steal',
    '//attacker.example/steal',
    '/\\attacker.example/steal',
  ])('falls back for unsafe or missing input: %p', (value) => {
    expect(sanitizeReturnTo(value)).toBe(DEFAULT_AUTH_RETURN_TO);
  });

  it('builds an onboarding or login URL with an encoded local return path', () => {
    expect(withReturnTo('/onboarding/profile', '/dashboard/bookings/new?slotId=slot-1')).toBe(
      '/onboarding/profile?returnTo=%2Fdashboard%2Fbookings%2Fnew%3FslotId%3Dslot-1',
    );
  });

  it('sanitizes the return path before adding it to a URL', () => {
    expect(withReturnTo('/', 'https://attacker.example/steal')).toBe('/?returnTo=%2Fdashboard');
  });
});

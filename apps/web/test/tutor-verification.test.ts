import { describe, expect, it } from 'vitest';

import { tutorVerificationCopy, visibleTutorVerificationStatus } from '@/lib/tutor-verification';

describe('tutor verification visibility', () => {
  it('exposes only VERIFIED to public viewers', () => {
    expect(visibleTutorVerificationStatus('VERIFIED', 'public')).toBe('VERIFIED');
    for (const status of ['PENDING', 'REJECTED', 'APPROVED', undefined, null, 'verified']) {
      expect(visibleTutorVerificationStatus(status, 'public')).toBeNull();
    }
  });

  it('distinguishes pending and rejected for the owner without inventing an unknown status', () => {
    for (const status of ['VERIFIED', 'PENDING', 'REJECTED']) {
      expect(visibleTutorVerificationStatus(status, 'owner')).toBe(status);
    }
    expect(visibleTutorVerificationStatus(undefined, 'owner')).toBeNull();
    expect(visibleTutorVerificationStatus('APPROVED', 'owner')).toBeNull();
  });

  it('provides distinct pending and rejected labels in both languages', () => {
    for (const language of ['en', 'th'] as const) {
      expect(tutorVerificationCopy[language].PENDING.label).not.toBe(
        tutorVerificationCopy[language].REJECTED.label,
      );
    }
  });
});

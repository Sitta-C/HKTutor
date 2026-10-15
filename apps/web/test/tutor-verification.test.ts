import { describe, expect, it } from 'vitest';

import { tutorVerificationCopy, visibleTutorVerificationStatus } from '@/lib/tutor-verification';

describe('tutor verification visibility', () => {
  it('exposes only VERIFIED to public viewers', () => {
    expect(visibleTutorVerificationStatus('VERIFIED', 'public')).toBe('VERIFIED');
    for (const status of [
      'UNVERIFIED',
      'PENDING',
      'REJECTED',
      'APPROVED',
      undefined,
      null,
      'verified',
    ]) {
      expect(visibleTutorVerificationStatus(status, 'public')).toBeNull();
    }
  });

  it('distinguishes all four states for the owner without inventing an unknown status', () => {
    for (const status of ['UNVERIFIED', 'VERIFIED', 'PENDING', 'REJECTED']) {
      expect(visibleTutorVerificationStatus(status, 'owner')).toBe(status);
    }
    expect(visibleTutorVerificationStatus(undefined, 'owner')).toBeNull();
    expect(visibleTutorVerificationStatus('APPROVED', 'owner')).toBeNull();
  });

  it('distinguishes missing documents, pending review and rejection in both languages', () => {
    for (const language of ['en', 'th'] as const) {
      const copy = tutorVerificationCopy[language];
      expect(new Set([copy.UNVERIFIED.label, copy.PENDING.label, copy.REJECTED.label]).size).toBe(
        3,
      );
      expect(copy.UNVERIFIED.description).not.toBe(copy.PENDING.description);
    }
  });
});

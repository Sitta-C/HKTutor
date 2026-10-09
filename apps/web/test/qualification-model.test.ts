import { describe, expect, it } from 'vitest';

import {
  QUALIFICATION_MAX_BYTES,
  canUploadType,
  qualificationErrorKind,
  signedUrlIsExpired,
  validateQualificationFile,
  validateReviewDecision,
} from '@/components/qualifications/qualification-model';
import { ApiError } from '@/lib/api/error';

describe('qualification model', () => {
  it('checks empty, unsupported and oversized files before upload', () => {
    expect(validateQualificationFile({ type: 'application/pdf', size: 0 })).toBe('empty');
    expect(validateQualificationFile({ type: 'image/webp', size: 10 })).toBe('type');
    expect(
      validateQualificationFile({ type: 'image/png', size: QUALIFICATION_MAX_BYTES + 1 }),
    ).toBe('size');
    for (const type of ['application/pdf', 'image/jpeg', 'image/png']) {
      expect(validateQualificationFile({ type, size: QUALIFICATION_MAX_BYTES })).toBeNull();
    }
  });

  it('blocks another pending upload of the same type while allowing reviewed replacements', () => {
    const documents = [
      { type: 'DEGREE', status: 'PENDING' },
      { type: 'CERTIFICATE', status: 'REJECTED' },
    ];
    expect(canUploadType(documents, 'DEGREE')).toBe(false);
    expect(canUploadType(documents, 'CERTIFICATE')).toBe(true);
  });

  it('trims notes and requires a bounded rejection reason', () => {
    expect(validateReviewDecision('REJECTED', '   ')).toBeNull();
    expect(validateReviewDecision('REJECTED', '  Missing seal  ')).toEqual({
      decision: 'REJECTED',
      reason: 'Missing seal',
    });
    expect(validateReviewDecision('APPROVED', '')).toEqual({ decision: 'APPROVED' });
    expect(validateReviewDecision('APPROVED', '  Looks valid  ')).toEqual({
      decision: 'APPROVED',
      reason: 'Looks valid',
    });
    expect(validateReviewDecision('REJECTED', 'x'.repeat(501))).toBeNull();
  });

  it('expires signed links before the storage deadline and maps denied/conflict failures', () => {
    const now = Date.parse('2026-10-09T00:00:00Z');
    expect(signedUrlIsExpired('2026-10-09T00:00:04Z', now)).toBe(true);
    expect(signedUrlIsExpired('2026-10-09T00:00:30Z', now)).toBe(false);
    expect(signedUrlIsExpired('invalid', now)).toBe(true);
    expect(qualificationErrorKind(new ApiError('Denied', 403))).toBe('denied');
    expect(qualificationErrorKind(new ApiError('Conflict', 409))).toBe('conflict');
    expect(qualificationErrorKind(new Error('offline'))).toBe('unavailable');
  });
});

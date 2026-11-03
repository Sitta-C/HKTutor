import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewCopy } from '@/components/reviews/review-copy';
import {
  REVIEW_FEEDBACK_MAX_LENGTH,
  canSubmitReview,
  isValidReviewRating,
  reviewEligibility,
  reviewFeedbackLength,
  reviewSubmitOutcome,
} from '@/components/reviews/review-model';
import { getMyBookingReview, submitBookingReview } from '@/lib/api/bookings';
import { clearAccessToken } from '@/lib/api/client';
import { ApiError } from '@/lib/api/error';

import type { BookingReview } from '@/lib/api/types';

describe('review feedback length and rating validation', () => {
  it('trims surrounding whitespace before counting', () => {
    expect(reviewFeedbackLength('  hello  ')).toBe(5);
  });
  it('counts Unicode code points, not UTF-16 code units', () => {
    expect(reviewFeedbackLength('😀'.repeat(10))).toBe(10);
    expect('😀'.repeat(10)).toHaveLength(20);
  });
  it('treats whitespace-only text as empty', () => {
    expect(reviewFeedbackLength('   ')).toBe(0);
  });
  it.each([1, 2, 3, 4, 5])('accepts the valid rating %s', (value) => {
    expect(isValidReviewRating(value)).toBe(true);
  });
  it.each([0, 6, -1, 4.5, NaN, null])('rejects the invalid rating %s', (value) => {
    expect(isValidReviewRating(value)).toBe(false);
  });
});

describe('canSubmitReview', () => {
  const valid = { clarity: 5, punctuality: 4, preparation: 3, feedback: 'Great class' };
  it('allows a fully valid submission', () => {
    expect(canSubmitReview(valid)).toBe(true);
  });
  it.each(['clarity', 'punctuality', 'preparation'] as const)(
    'blocks submission when %s is missing',
    (field) => {
      expect(canSubmitReview({ ...valid, [field]: null })).toBe(false);
    },
  );
  it('blocks empty feedback', () => {
    expect(canSubmitReview({ ...valid, feedback: '   ' })).toBe(false);
  });
  it('blocks feedback over the limit and accepts exactly the limit', () => {
    expect(
      canSubmitReview({ ...valid, feedback: 'a'.repeat(REVIEW_FEEDBACK_MAX_LENGTH + 1) }),
    ).toBe(false);
    expect(canSubmitReview({ ...valid, feedback: 'a'.repeat(REVIEW_FEEDBACK_MAX_LENGTH) })).toBe(
      true,
    );
  });
});

describe('reviewEligibility', () => {
  const review: BookingReview = {
    id: 'review-1',
    clarity: 5,
    punctuality: 4,
    preparation: 5,
    overallRating: 4.67,
    feedback: 'Great',
    createdAt: '2026-10-17T10:00:00.000Z',
  };
  it('shows saved whenever a review exists, regardless of status', () => {
    expect(reviewEligibility('COMPLETED', review)).toBe('saved');
    expect(reviewEligibility('CONFIRMED', review)).toBe('saved');
  });
  it('shows ready only for a COMPLETED booking with no review', () => {
    expect(reviewEligibility('COMPLETED', null)).toBe('ready');
  });
  it.each(['PENDING', 'CONFIRMED', 'CANCELED', 'EXPIRED'] as const)(
    'locks a %s booking with no review',
    (status) => {
      expect(reviewEligibility(status, null)).toBe('locked');
    },
  );
});

describe('reviewSubmitOutcome', () => {
  it('treats a non-ApiError (network failure) as uncertain', () => {
    expect(reviewSubmitOutcome(new TypeError('Network failure'))).toBe('uncertain');
  });
  it.each([500, 502, 503])('treats a %s server error as uncertain', (status) => {
    expect(reviewSubmitOutcome(new ApiError('Server error', status))).toBe('uncertain');
  });
  it('maps 401 to unauthenticated', () => {
    expect(reviewSubmitOutcome(new ApiError('Unauthenticated', 401))).toBe('unauthenticated');
  });
  it('maps 403 to forbidden', () => {
    expect(reviewSubmitOutcome(new ApiError('Forbidden', 403))).toBe('forbidden');
  });
  it('maps 404 to notFound', () => {
    expect(reviewSubmitOutcome(new ApiError('Not found', 404))).toBe('notFound');
  });
  it('maps a plain 400 to validation', () => {
    expect(reviewSubmitOutcome(new ApiError('Bad request', 400))).toBe('validation');
  });
  it('maps 409 REVIEW_ALREADY_EXISTS to alreadyExists', () => {
    expect(
      reviewSubmitOutcome(
        new ApiError('Conflict', 409, { code: 'REVIEW_ALREADY_EXISTS', message: 'exists' }),
      ),
    ).toBe('alreadyExists');
  });
  it('maps 409 BOOKING_NOT_COMPLETED to notCompleted', () => {
    expect(
      reviewSubmitOutcome(
        new ApiError('Conflict', 409, { code: 'BOOKING_NOT_COMPLETED', message: 'not completed' }),
      ),
    ).toBe('notCompleted');
  });
  it('maps an unrecognized 409 code to notCompleted rather than throwing', () => {
    expect(reviewSubmitOutcome(new ApiError('Conflict', 409, { code: 'OTHER' }))).toBe(
      'notCompleted',
    );
  });
  it('maps a 409 with no details to notCompleted', () => {
    expect(reviewSubmitOutcome(new ApiError('Conflict', 409))).toBe('notCompleted');
  });
});

describe('review copy', () => {
  it('keeps bilingual copy keys aligned', () => {
    expect(Object.keys(reviewCopy.th).sort()).toEqual(Object.keys(reviewCopy.en).sort());
  });
});

describe('review API client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    clearAccessToken();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    clearAccessToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function response(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  it('reads the review endpoint with an encoded booking ID', async () => {
    fetchMock.mockResolvedValueOnce(response({ review: null }));
    await expect(getMyBookingReview('booking/id')).resolves.toEqual({ review: null });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bookings/me/booking%2Fid/review',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
  it('posts the rating and feedback fields only, and unwraps the created review', async () => {
    const review: BookingReview = {
      id: 'review-1',
      clarity: 5,
      punctuality: 4,
      preparation: 5,
      overallRating: 4.67,
      feedback: 'Great class',
      createdAt: '2026-10-17T10:00:00.000Z',
    };
    fetchMock.mockResolvedValueOnce(response({ review }, 201));
    const payload = { clarity: 5, punctuality: 4, preparation: 5, feedback: 'Great class' };
    await expect(submitBookingReview('booking/id', payload)).resolves.toEqual(review);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bookings/me/booking%2Fid/reviews',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        credentials: 'include',
      }),
    );
  });
  it.each([400, 403, 404, 409, 500])(
    'preserves a %s submission response without retrying the write',
    async (status) => {
      fetchMock.mockResolvedValueOnce(response({ message: 'Rejected' }, status));
      await expect(
        submitBookingReview('booking-id', {
          clarity: 5,
          punctuality: 5,
          preparation: 5,
          feedback: 'x',
        }),
      ).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('does not retry a submission when its response is lost', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network failure'));
    await expect(
      submitBookingReview('booking-id', {
        clarity: 5,
        punctuality: 5,
        preparation: 5,
        feedback: 'x',
      }),
    ).rejects.toThrow('Network failure');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

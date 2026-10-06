import { describe, expect, it } from 'vitest';

import { buildProfileRatingSummary } from '@/components/profile/profile-rating-model';

describe('profile rating summary', () => {
  it.each([
    ['4.80', 4.8, [100, 100, 100, 100, 80]],
    ['3.50', 3.5, [100, 100, 100, 50, 0]],
    ['4.40', 4.4, [100, 100, 100, 100, 40]],
    ['5.00', 5, [100, 100, 100, 100, 100]],
    ['0.00', 0, [0, 0, 0, 0, 0]],
  ])('fills five stars for a %s rating', (value, score, starFills) => {
    expect(buildProfileRatingSummary(value, 24)).toEqual({ score, starFills });
  });

  it.each([null, '', 'invalid', 'Infinity', '-1', '6'])(
    'does not fabricate a %s rating',
    (value) => {
      expect(buildProfileRatingSummary(value, 24)).toEqual({
        score: null,
        starFills: [0, 0, 0, 0, 0],
      });
    },
  );

  it('does not show stale stars for a tutor without reviews', () => {
    expect(buildProfileRatingSummary('4.80', 0)).toEqual({
      score: null,
      starFills: [0, 0, 0, 0, 0],
    });
  });
});

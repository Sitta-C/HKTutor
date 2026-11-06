import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildTutorRatingSummary } from '@/components/tutors/tutor-rating-model';
import { TutorRatingSummary } from '@/components/tutors/tutor-rating-summary';

describe('tutor rating display', () => {
  it.each([
    [4.33, '4.33'],
    ['4.33', '4.33'],
    [4, '4.00'],
    [1, '1.00'],
    [5, '5.00'],
    [4.125, '4.13'],
    ['4.125', '4.13'],
    [4.005, '4.01'],
  ])('formats %s to %s with positive HALF_UP rounding', (value, score) => {
    expect(buildTutorRatingSummary(value, 2)).toEqual({ state: 'rated', score, reviewCount: 2 });
  });

  it.each([null, '4.80', 4.8, 0])('shows a new tutor when count is zero, ignoring %s', (value) => {
    expect(buildTutorRatingSummary(value, 0)).toEqual({
      state: 'new',
      score: null,
      reviewCount: 0,
    });
  });

  it.each([null, '', 'invalid', 'Infinity', '-1', '0.00', 0, 6, NaN])(
    'keeps existing reviews without inventing a %s score or calling the tutor new',
    (value) => {
      expect(buildTutorRatingSummary(value, 2)).toEqual({
        state: 'unavailable',
        score: null,
        reviewCount: 2,
      });
    },
  );

  it.each([-1, 1.5, NaN, Infinity])(
    'does not fabricate a zero for an invalid count %s',
    (count) => {
      expect(buildTutorRatingSummary(4.33, count)).toEqual({
        state: 'unavailable',
        score: null,
        reviewCount: null,
      });
    },
  );
});

describe('Margin Score presentation', () => {
  it.each(['en', 'th'] as const)('renders accessible score and actual count in %s', (language) => {
    const markup = renderToStaticMarkup(
      createElement(TutorRatingSummary, { ratingAverage: 4.33, reviewCount: 2, language }),
    );
    expect(markup).toContain('data-tutor-rating="rated"');
    expect(markup).toContain(language === 'en' ? 'Rated 4.33 out of 5' : 'คะแนน 4.33 จาก 5');
    expect(markup).toContain('<strong>2</strong>');
    expect(markup).not.toContain('<button');
  });

  it.each(['en', 'th'] as const)(
    'shows new tutor and count zero without stars in %s',
    (language) => {
      const markup = renderToStaticMarkup(
        createElement(TutorRatingSummary, { ratingAverage: null, reviewCount: 0, language }),
      );
      expect(markup).toContain('data-tutor-rating="new"');
      expect(markup).toContain(language === 'en' ? 'New tutor' : 'ติวเตอร์ใหม่');
      expect(markup).toContain('<strong>0</strong>');
      expect(markup).not.toContain('0.00');
      expect(markup).not.toContain('role="img"');
      expect(markup).not.toContain('<svg');
    },
  );

  it('uses singular English review text', () => {
    const markup = renderToStaticMarkup(
      createElement(TutorRatingSummary, { ratingAverage: '5.00', reviewCount: 1, language: 'en' }),
    );
    expect(markup).toContain('<span>review</span>');
  });
});

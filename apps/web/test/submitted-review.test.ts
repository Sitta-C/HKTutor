import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SubmittedReview } from '@/components/reviews/submitted-review';

import type { BookingReview } from '@/lib/api/types';

const review: BookingReview = {
  id: 'review-1',
  clarity: 5,
  punctuality: 4,
  preparation: 5,
  overallRating: 4.67,
  feedback: 'Great class, very clear explanations.',
  createdAt: '2026-10-16T18:30:00.000Z',
};

describe('submitted review', () => {
  it('renders ratings, overall average and feedback as literal text in English', () => {
    const markup = renderToStaticMarkup(createElement(SubmittedReview, { review, language: 'en' }));
    expect(markup).toContain('5 / 5');
    expect(markup).toContain('4 / 5');
    expect(markup).toContain('4.67 / 5');
    expect(markup).toContain('Great class, very clear explanations.');
    expect(markup).toContain('dateTime="2026-10-16T18:30:00.000Z"');
  });
  it('renders in Thai with the Buddhist display year', () => {
    const markup = renderToStaticMarkup(createElement(SubmittedReview, { review, language: 'th' }));
    expect(markup).toContain('รีวิวของคุณ');
    expect(markup).toContain('2569');
  });
  it('never interprets markup-looking feedback', () => {
    const markup = renderToStaticMarkup(
      createElement(SubmittedReview, {
        review: { ...review, feedback: '<b>bold</b> & "quotes"' },
        language: 'en',
      }),
    );
    expect(markup).not.toContain('<b>bold</b>');
    expect(markup).toContain('&lt;b&gt;bold&lt;/b&gt;');
  });
});

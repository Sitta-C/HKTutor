import { describe, expect, it } from 'vitest';

import {
  comparisonSortQueryValue,
  withComparisonSort,
} from '@/components/tutors/comparison-sort-query';
import { validateComparisonSort } from '@/components/tutors/tutor-comparison-sort';

describe('comparison sort query (S3-T34)', () => {
  it.each([
    ['', undefined, null],
    ['comparisonSort=highest_rating', 'highest_rating', null],
    ['comparisonSort=', '', 'invalid_sort'],
    ['comparisonSort=unknown', 'unknown', 'invalid_sort'],
    [
      'comparisonSort=lowest_price&comparisonSort=highest_rating',
      ['lowest_price', 'highest_rating'],
      'invalid_sort',
    ],
    [
      'comparisonSort=lowest_price&comparisonSort=lowest_price',
      ['lowest_price', 'lowest_price'],
      'invalid_sort',
    ],
  ])('preserves validation for %s', (query, expectedValue, error) => {
    const value = comparisonSortQueryValue(new URLSearchParams(String(query)));
    expect(value).toEqual(expectedValue);
    expect(validateComparisonSort(value).error).toBe(error);
  });

  it('changes only the sort while retaining IDs, order, repeated parameters and fragment', () => {
    const url = new URL(
      'https://example.test/tutors?tutorIds=a%2Cb&listingIds=one%2Ftwo&selectionOrder=1%2C0&keep=first&keep=second&comparisonSort=bad&comparisonSort=#comparison',
    );
    const original = url.href;
    const next = new URL(withComparisonSort(url, 'earliest_availability'), url.origin);
    expect(next.searchParams.getAll('comparisonSort')).toEqual(['earliest_availability']);
    for (const key of ['tutorIds', 'listingIds', 'selectionOrder', 'keep']) {
      expect(next.searchParams.getAll(key)).toEqual(url.searchParams.getAll(key));
    }
    expect(next.pathname).toBe('/tutors');
    expect(next.hash).toBe('#comparison');
    expect(url.href).toBe(original);
  });

  it('adds the priority to an otherwise empty URL', () => {
    expect(withComparisonSort(new URL('https://example.test/tutors'), 'lowest_price')).toBe(
      '/tutors?comparisonSort=lowest_price',
    );
  });
});

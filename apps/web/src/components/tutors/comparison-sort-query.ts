import type { ComparisonSort } from '@/components/tutors/tutor-comparison-sort';

/** Preserve repeated values so the existing validator can reject ambiguous URLs. */
export function comparisonSortQueryValue(
  params: Pick<URLSearchParams, 'getAll'>,
): string | string[] | undefined {
  const values = params.getAll('comparisonSort');
  return values.length > 1 ? values : values[0];
}

/** Change only the comparison priority, retaining other parameters and the fragment. */
export function withComparisonSort(url: URL, sort: ComparisonSort): string {
  const params = new URLSearchParams(url.search);
  params.set('comparisonSort', sort);
  return `${url.pathname}?${params.toString()}${url.hash}`;
}

export interface TutorRatingSummary {
  readonly state: 'rated' | 'new' | 'unavailable';
  readonly score: string | null;
  readonly reviewCount: number | null;
}

const ratingFormatter = new Intl.NumberFormat('en', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  roundingMode: 'halfExpand',
});

export function buildTutorRatingSummary(
  ratingAverage: number | string | null,
  reviewCount: number,
): TutorRatingSummary {
  if (!Number.isSafeInteger(reviewCount) || reviewCount < 0) {
    return { state: 'unavailable', score: null, reviewCount: null };
  }
  if (reviewCount === 0) {
    return { state: 'new', score: null, reviewCount: 0 };
  }

  const value = Number(ratingAverage);
  if (
    ratingAverage === null ||
    (typeof ratingAverage === 'string' && ratingAverage.trim() === '') ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > 5
  ) {
    return { state: 'unavailable', score: null, reviewCount };
  }

  // The API owns raw review aggregation. Format its display value, never average reviews here.
  // halfExpand is HALF_UP for the positive 1–5 rating range.
  return { state: 'rated', score: ratingFormatter.format(value), reviewCount };
}

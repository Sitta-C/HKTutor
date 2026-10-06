export interface ProfileRatingSummary {
  readonly score: number | null;
  readonly starFills: readonly number[];
}

export function buildProfileRatingSummary(
  ratingAverage: string | null,
  reviewCount: number,
): ProfileRatingSummary {
  const value = Number(ratingAverage);
  const hasRating =
    reviewCount > 0 &&
    ratingAverage !== null &&
    ratingAverage.trim() !== '' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 5;
  const score = hasRating ? Math.round(value * 10) / 10 : null;

  return {
    score,
    starFills: Array.from({ length: 5 }, (_, index) =>
      Math.round(Math.max(0, Math.min(1, (score ?? 0) - index)) * 100),
    ),
  };
}

import { BadRequestException } from '@nestjs/common';

import type { Prisma } from '@generated/prisma/client';
import type { TutorReviewTotals } from '@modules/reviews/review-ratings';
import type { TutorSearchQueryDto } from '@modules/tutors/tutors.dto';

export enum TutorRankingPriority {
  LOWEST_PRICE = 'lowest_price',
  HIGHEST_RATING = 'highest_rating',
  EARLIEST_AVAILABILITY = 'earliest_availability',
}

export enum TutorRecommendationTag {
  FITS_BUDGET = 'FITS_BUDGET',
  LOWEST_PRICE = 'LOWEST_PRICE',
  HIGHEST_RATED = 'HIGHEST_RATED',
  EARLIEST_AVAILABILITY = 'EARLIEST_AVAILABILITY',
}

/** S3-T17 raw review totals for a tutor with at least one review; never the rounded cache. */
export type TutorRawRating = Pick<TutorReviewTotals, 'dimensionTotal' | 'reviewCount'>;

export interface TutorRecommendationContext {
  maxPrice?: number;
  lowestPrice: Prisma.Decimal | null;
  highestRating: TutorRawRating | null;
  earliestAvailableAt: Date | null;
}

/** Compares two unrounded averages exactly by cross-multiplying, so 13/3 equals 26/6 (S3-T19). */
export function hasEqualRawRating(a: TutorRawRating, b: TutorRawRating): boolean {
  return (
    a.reviewCount > 0 &&
    b.reviewCount > 0 &&
    a.dimensionTotal.times(b.reviewCount).equals(b.dimensionTotal.times(a.reviewCount))
  );
}

/** Named priorities delegate to the existing sorter without changing its query implementation. */
export function resolveTutorRankingQuery(query: TutorSearchQueryDto): TutorSearchQueryDto {
  if (query.priority === undefined) {
    return query;
  }

  if (
    query.pricePriority !== undefined ||
    query.priceOrder !== undefined ||
    query.ratingPriority !== undefined ||
    query.ratingOrder !== undefined ||
    query.availabilityPriority !== undefined ||
    query.availabilityOrder !== undefined
  ) {
    throw new BadRequestException('priority cannot be combined with individual sort parameters');
  }

  switch (query.priority) {
    case TutorRankingPriority.LOWEST_PRICE:
      return { ...query, priceOrder: 'asc', pricePriority: 1 };
    case TutorRankingPriority.HIGHEST_RATING:
      return { ...query, ratingOrder: 'desc', ratingPriority: 1 };
    case TutorRankingPriority.EARLIEST_AVAILABILITY:
      return { ...query, availabilityOrder: 'asc', availabilityPriority: 1 };
    default:
      throw new BadRequestException('priority is not a supported tutor ranking priority');
  }
}

export function buildTutorRecommendationTags(
  listing: {
    pricePerHour: Prisma.Decimal;
    rating: TutorRawRating | null;
    nextAvailableAt: Date | null;
  },
  context: TutorRecommendationContext,
): TutorRecommendationTag[] {
  const tags: TutorRecommendationTag[] = [];

  if (context.maxPrice !== undefined && listing.pricePerHour.lte(context.maxPrice)) {
    tags.push(TutorRecommendationTag.FITS_BUDGET);
  }
  if (context.lowestPrice !== null && listing.pricePerHour.equals(context.lowestPrice)) {
    tags.push(TutorRecommendationTag.LOWEST_PRICE);
  }
  if (
    context.highestRating !== null &&
    listing.rating !== null &&
    hasEqualRawRating(listing.rating, context.highestRating)
  ) {
    tags.push(TutorRecommendationTag.HIGHEST_RATED);
  }
  if (
    context.earliestAvailableAt !== null &&
    listing.nextAvailableAt?.getTime() === context.earliestAvailableAt.getTime()
  ) {
    tags.push(TutorRecommendationTag.EARLIEST_AVAILABILITY);
  }

  return tags;
}

import { BadRequestException } from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import {
  buildTutorRecommendationTags,
  hasEqualRawRating,
  resolveTutorRankingQuery,
  TutorRankingPriority,
  TutorRecommendationTag,
} from '@modules/tutors/tutor-ranking';

import type { TutorRawRating, TutorRecommendationContext } from '@modules/tutors/tutor-ranking';
import type { TutorSearchQueryDto } from '@modules/tutors/tutors.dto';

const context = (
  overrides: Partial<TutorRecommendationContext> = {},
): TutorRecommendationContext => ({
  earliestAvailableAt: null,
  highestRating: null,
  lowestPrice: null,
  ...overrides,
});
const raw = (dimensionTotal: number, reviewCount: number): TutorRawRating => ({
  dimensionTotal: new Prisma.Decimal(dimensionTotal),
  reviewCount,
});
const listing = {
  nextAvailableAt: new Date('2026-10-14T02:00:00.000Z'),
  pricePerHour: new Prisma.Decimal('400.50'),
  rating: raw(72, 5),
};

describe('tutor ranking contract', () => {
  it.each([
    [TutorRankingPriority.LOWEST_PRICE, { priceOrder: 'asc', pricePriority: 1 }],
    [TutorRankingPriority.HIGHEST_RATING, { ratingOrder: 'desc', ratingPriority: 1 }],
    [
      TutorRankingPriority.EARLIEST_AVAILABILITY,
      { availabilityOrder: 'asc', availabilityPriority: 1 },
    ],
  ])('delegates %s while preserving filters and pagination', (priority, sort) => {
    const query = {
      maxPrice: 500,
      minimumRating: 4,
      page: 3,
      pageSize: 5,
      priority,
      subject: 'Math',
    };
    expect(resolveTutorRankingQuery(query)).toEqual({ ...query, ...sort });
    expect(query).not.toHaveProperty('pricePriority');
  });

  it('preserves individual sort settings when no named mode is requested', () => {
    const query: TutorSearchQueryDto = { priceOrder: 'desc', pricePriority: 2, ratingPriority: 1 };
    expect(resolveTutorRankingQuery(query)).toBe(query);
  });

  it.each([
    { pricePriority: 0 },
    { priceOrder: 'asc' as const },
    { ratingPriority: 0 },
    { ratingOrder: 'desc' as const },
    { availabilityPriority: 0 },
    { availabilityOrder: 'asc' as const },
  ])('rejects ambiguous named and individual settings: %p', (individual) => {
    expect(() =>
      resolveTutorRankingQuery({
        ...individual,
        priority: TutorRankingPriority.LOWEST_PRICE,
      }),
    ).toThrow(BadRequestException);
  });
});

describe('truthful tutor explanation tags', () => {
  it('includes an equal decimal budget but excludes a price one satang above it', () => {
    expect(buildTutorRecommendationTags(listing, context({ maxPrice: 400.5 }))).toEqual([
      TutorRecommendationTag.FITS_BUDGET,
    ]);
    expect(buildTutorRecommendationTags(listing, context({ maxPrice: 400.49 }))).toEqual([]);
  });

  it('does not invent budget or best-value tags without supporting data', () => {
    expect(buildTutorRecommendationTags(listing, context())).toEqual([]);
  });

  it('marks actual tied best values and keeps their explanation order stable', () => {
    expect(
      buildTutorRecommendationTags(
        listing,
        context({
          earliestAvailableAt: new Date(listing.nextAvailableAt),
          highestRating: raw(144, 10),
          lowestPrice: new Prisma.Decimal('400.50'),
          maxPrice: 500,
        }),
      ),
    ).toEqual([
      TutorRecommendationTag.FITS_BUDGET,
      TutorRecommendationTag.LOWEST_PRICE,
      TutorRecommendationTag.HIGHEST_RATED,
      TutorRecommendationTag.EARLIEST_AVAILABILITY,
    ]);
  });

  it('does not label a page-local winner when a better filtered result exists elsewhere', () => {
    expect(
      buildTutorRecommendationTags(
        listing,
        context({
          earliestAvailableAt: new Date('2026-10-13T02:00:00.000Z'),
          highestRating: raw(147, 10),
          lowestPrice: new Prisma.Decimal('350'),
        }),
      ),
    ).toEqual([]);
  });

  it('never labels an unrated or no-slot tutor as highest-rated or earliest available', () => {
    expect(
      buildTutorRecommendationTags(
        { ...listing, nextAvailableAt: null, rating: null },
        context({
          highestRating: raw(72, 5),
          earliestAvailableAt: listing.nextAvailableAt,
        }),
      ),
    ).toEqual([]);
  });
});

describe('exact raw rating comparison (S3-T19)', () => {
  it('treats equal ratios as the same average, such as 13/3 and 26/6', () => {
    expect(hasEqualRawRating(raw(13, 1), raw(26, 2))).toBe(true);
    expect(hasEqualRawRating(raw(62, 5), raw(124, 10))).toBe(true);
  });

  it('keeps averages apart that only display alike: 4.1333 and 4.125 both show 4.13', () => {
    expect(hasEqualRawRating(raw(62, 5), raw(99, 8))).toBe(false);
  });

  it('never matches a tutor without reviews', () => {
    expect(hasEqualRawRating(raw(0, 0), raw(0, 0))).toBe(false);
    expect(hasEqualRawRating(raw(15, 1), raw(0, 0))).toBe(false);
  });

  it('tags HIGHEST_RATED only for an exactly equal raw average', () => {
    const best = context({ highestRating: raw(62, 5) });
    expect(buildTutorRecommendationTags({ ...listing, rating: raw(124, 10) }, best)).toEqual([
      TutorRecommendationTag.HIGHEST_RATED,
    ]);
    expect(buildTutorRecommendationTags({ ...listing, rating: raw(99, 8) }, best)).toEqual([]);
  });
});

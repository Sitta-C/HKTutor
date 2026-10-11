import { BadRequestException } from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import {
  buildTutorRecommendationTags,
  resolveTutorRankingQuery,
  TutorRankingPriority,
  TutorRecommendationTag,
} from '@modules/tutors/tutor-ranking';

import type { TutorRecommendationContext } from '@modules/tutors/tutor-ranking';
import type { TutorSearchQueryDto } from '@modules/tutors/tutors.dto';

const context = (
  overrides: Partial<TutorRecommendationContext> = {},
): TutorRecommendationContext => ({
  earliestAvailableAt: null,
  highestRating: null,
  lowestPrice: null,
  ...overrides,
});
const listing = {
  nextAvailableAt: new Date('2026-10-14T02:00:00.000Z'),
  pricePerHour: new Prisma.Decimal('400.50'),
  ratingAverage: new Prisma.Decimal('4.8'),
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
          highestRating: new Prisma.Decimal('4.80'),
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
          highestRating: new Prisma.Decimal('4.9'),
          lowestPrice: new Prisma.Decimal('350'),
        }),
      ),
    ).toEqual([]);
  });

  it('never labels an unrated or no-slot tutor as highest-rated or earliest available', () => {
    expect(
      buildTutorRecommendationTags(
        { ...listing, nextAvailableAt: null, ratingAverage: null },
        context({
          highestRating: new Prisma.Decimal('4.8'),
          earliestAvailableAt: listing.nextAvailableAt,
        }),
      ),
    ).toEqual([]);
  });
});

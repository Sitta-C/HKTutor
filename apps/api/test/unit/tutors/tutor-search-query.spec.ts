import { ListingPublicationStatus } from '@generated/prisma/enums';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';
import { resolveTutorRankingQuery, TutorRankingPriority } from '@modules/tutors/tutor-ranking';
import {
  PUBLIC_SEARCH_CONDITIONS,
  RATING_KEY,
  searchConditions,
  searchOrderBy,
  searchSources,
} from '@modules/tutors/tutor-search-query';

import type { TutorSearchQueryDto } from '@modules/tutors/tutors.dto';

// S3-T19: structure of the raw search SQL. Exact PostgreSQL arithmetic (13/3 against 4.33 and
// 4.34, equal and near-equal averages) is checked against a real database by
// db:verify:search-ratings.

const SUBJECT_ID = '11111111-1111-4111-8111-111111111111';
const GRADE_ID = '22222222-2222-4222-8222-222222222222';
const RATING = RATING_KEY.sql;

const squash = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
const orderFor = (query: TutorSearchQueryDto): string =>
  squash(searchOrderBy(resolveTutorRankingQuery(query)).sql);

describe('tutor search SQL (S3-T19)', () => {
  it('orders by the unrounded review average at a fixed scale and gives unreviewed tutors no key', () => {
    expect(squash(RATING)).toBe(
      'CASE WHEN rt."reviewCount" > 0 THEN rt."ratingTotal"::numeric(38, 20) / (rt."reviewCount" * 3) END',
    );
  });

  it('reads ratings from Review rows, never the rounded TutorProfile cache', () => {
    const now = new Date('2026-11-10T11:00:00.000Z');
    const sources = searchSources(now);
    const text = squash(sources.sql);

    expect(text).toContain(
      'SUM(r."clarity" + r."punctuality" + r."preparation"), 0)::bigint AS "ratingTotal"',
    );
    expect(text).toContain('COUNT(*)::int AS "reviewCount" FROM "Review" r');
    expect(text).toContain('WHERE r."tutorProfileId" = tp."userId"');
    expect(text).not.toMatch(/tp\."(ratingAverage|reviewCount)"/);
    expect(text).toContain(
      `b."status" IN ('pending'::"BookingStatus", 'confirmed'::"BookingStatus")`,
    );
    expect(sources.values).toEqual([now]);
  });

  it('keeps the same visibility rules as publicListingWhere and publicTutorWhere', () => {
    const text = squash(PUBLIC_SEARCH_CONDITIONS.sql);
    const label = (value: string): string => value.toLowerCase();

    expect(text).toContain(
      `tl."publicationStatus" = '${label(ListingPublicationStatus.PUBLISHED)}'::"ListingPublicationStatus"`,
    );
    expect(text).toContain('tl."publishedAt" IS NOT NULL AND tl."deletedAt" IS NULL');
    expect(text).toContain(
      `tp."verificationStatus" = '${label(publicTutorWhere.verificationStatus)}'::"TutorVerificationStatus"`,
    );
    expect(text).toContain(
      `u."accountStatus" = '${label(publicTutorWhere.user.accountStatus)}'::"AccountStatus"`,
    );
    expect(text).toContain('u."deletedAt" IS NULL');
    expect(text).toContain(`u."role" = '${label(publicTutorWhere.user.role)}'::"Role"`);
    expect(PUBLIC_SEARCH_CONDITIONS.values).toEqual([]);
  });

  it('applies only visibility when no filter is supplied', () => {
    const conditions = searchConditions({});

    expect(squash(conditions.sql)).toBe(squash(PUBLIC_SEARCH_CONDITIONS.sql));
    expect(conditions.values).toEqual([]);
  });

  it('ANDs every filter and compares minimumRating exactly, without division or rounding', () => {
    const conditions = searchConditions({
      subjectId: SUBJECT_ID,
      gradeLevelId: GRADE_ID,
      maxPrice: 400.5,
      minimumRating: 4.34,
    });
    const text = squash(conditions.sql);

    expect(text).toContain(
      'AND tl."subjectId" = ?::uuid AND tl."gradeLevelId" = ?::uuid AND tl."pricePerHour" <= ?::numeric',
    );
    expect(text).toMatch(
      /AND rt\."reviewCount" > 0 AND rt\."ratingTotal" >= \?::numeric \* 3 \* rt\."reviewCount"$/,
    );
    expect(text).not.toContain('/');
    expect(conditions.values).toEqual([SUBJECT_ID, GRADE_ID, '400.50', '4.34']);
  });

  it.each([
    [1, '1.00'],
    [5, '5.00'],
    [4.3, '4.30'],
  ])('passes minimumRating %p as the exact decimal %p', (minimumRating, value) => {
    expect(searchConditions({ minimumRating }).values).toEqual([value]);
  });

  it('keeps the default order when no sort is requested', () => {
    expect(orderFor({})).toBe('tl."publishedAt" DESC, tl."id" ASC');
  });

  it.each([
    [
      TutorRankingPriority.HIGHEST_RATING,
      `${squash(RATING)} DESC NULLS LAST, tl."publishedAt" DESC, tl."id" ASC`,
    ],
    [
      TutorRankingPriority.LOWEST_PRICE,
      `tl."pricePerHour" ASC, ${squash(RATING)} DESC NULLS LAST, tl."publishedAt" DESC, tl."id" ASC`,
    ],
    [
      TutorRankingPriority.EARLIEST_AVAILABILITY,
      'na."nextAvailableAt" ASC NULLS LAST, tl."publishedAt" DESC, tl."id" ASC',
    ],
  ])('orders %s with the S2-T13 tie-breaks on raw ratings', (priority, expected) => {
    expect(orderFor({ priority })).toBe(expected);
  });

  it('orders individual sorts by priority and direction without the rating tie-break', () => {
    expect(
      orderFor({
        availabilityOrder: 'desc',
        availabilityPriority: 3,
        priceOrder: 'desc',
        pricePriority: 1,
        ratingOrder: 'asc',
        ratingPriority: 2,
      }),
    ).toBe(
      `tl."pricePerHour" DESC, ${squash(RATING)} ASC NULLS LAST, ` +
        'na."nextAvailableAt" DESC NULLS LAST, tl."publishedAt" DESC, tl."id" ASC',
    );
  });

  it('keeps the highest raw rating as the price tie-break for an individual price sort', () => {
    expect(orderFor({ priceOrder: 'desc', pricePriority: 1 })).toBe(
      `tl."pricePerHour" DESC, ${squash(RATING)} DESC NULLS LAST, tl."publishedAt" DESC, tl."id" ASC`,
    );
  });

  it('never sends query input into ORDER BY', () => {
    expect(
      searchOrderBy(resolveTutorRankingQuery({ priority: TutorRankingPriority.HIGHEST_RATING }))
        .values,
    ).toEqual([]);
  });
});

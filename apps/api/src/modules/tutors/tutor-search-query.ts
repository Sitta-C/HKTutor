import { Prisma } from '@generated/prisma/client';

import type { TutorSearchQueryDto } from '@modules/tutors/tutors.dto';

/**
 * SQL pieces for public tutor search (S3-T19). Every statement reads the same sources: `tl`
 * listing, `tp` tutor profile, `u` user, `rt` the tutor's raw review totals and `na` the next free
 * slot. Ratings come from Review rows, never the rounded TutorProfile.ratingAverage display cache.
 */

/**
 * Average of the three review dimensions, kept unrounded for ordering. The numerator's fixed
 * scale fixes PostgreSQL's division scale, so equal averages such as 13/3 and 26/6 produce the same
 * key and distinct averages stay distinct. Tutors without reviews have no key.
 */
export const RATING_KEY = Prisma.raw(
  `CASE WHEN rt."reviewCount" > 0
     THEN rt."ratingTotal"::numeric(38, 20) / (rt."reviewCount" * 3) END`,
);

/** Mirrors publicListingWhere and publicTutorWhere for the raw statements. */
export const PUBLIC_SEARCH_CONDITIONS = Prisma.sql`tl."publicationStatus" = 'published'::"ListingPublicationStatus"
  AND tl."publishedAt" IS NOT NULL
  AND tl."deletedAt" IS NULL
  AND tp."verificationStatus" = 'verified'::"TutorVerificationStatus"
  AND u."accountStatus" = 'active'::"AccountStatus"
  AND u."deletedAt" IS NULL
  AND u."role" = 'tutor'::"Role"`;

export function searchSources(now: Date): Prisma.Sql {
  return Prisma.sql`"TeachingListing" tl
    JOIN "TutorProfile" tp ON tp."userId" = tl."tutorProfileId"
    JOIN "User" u ON u."id" = tp."userId"
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(r."clarity" + r."punctuality" + r."preparation"), 0)::bigint AS "ratingTotal",
        COUNT(*)::int AS "reviewCount"
      FROM "Review" r
      WHERE r."tutorProfileId" = tp."userId"
    ) rt ON TRUE
    LEFT JOIN LATERAL (
      SELECT MIN(slot."startAtUtc") AS "nextAvailableAt"
      FROM "AvailabilitySlot" slot
      WHERE slot."tutorProfileId" = tp."userId"
        AND slot."startAtUtc" > ${now}
        AND slot."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "Booking" b
          WHERE b."slotId" = slot."id"
            AND b."status" IN ('pending'::"BookingStatus", 'confirmed'::"BookingStatus")
        )
    ) na ON TRUE`;
}

export interface TutorSearchFilters {
  subjectId?: string;
  gradeLevelId?: string;
  maxPrice?: number;
  minimumRating?: number;
}

/**
 * Visibility plus the AND filters. minimumRating is inclusive and exact: total >= minimum * 3 *
 * count, with no division or rounding, so 13/3 (4.333...) passes 4.33 and fails 4.34. Tutors
 * without reviews never pass. The DTO allows at most two decimals, so toFixed(2) is lossless.
 */
export function searchConditions(filters: TutorSearchFilters): Prisma.Sql {
  const conditions = [
    PUBLIC_SEARCH_CONDITIONS,
    ...(filters.subjectId === undefined
      ? []
      : [Prisma.sql`tl."subjectId" = ${filters.subjectId}::uuid`]),
    ...(filters.gradeLevelId === undefined
      ? []
      : [Prisma.sql`tl."gradeLevelId" = ${filters.gradeLevelId}::uuid`]),
    ...(filters.maxPrice === undefined
      ? []
      : [Prisma.sql`tl."pricePerHour" <= ${filters.maxPrice.toFixed(2)}::numeric`]),
    ...(filters.minimumRating === undefined
      ? []
      : [
          Prisma.sql`rt."reviewCount" > 0
            AND rt."ratingTotal" >= ${filters.minimumRating.toFixed(2)}::numeric * 3 * rt."reviewCount"`,
        ]),
  ];
  return Prisma.join(conditions, ' AND ');
}

const direction = (order: 'asc' | 'desc' | undefined, fallback: 'ASC' | 'DESC'): string =>
  order === undefined ? fallback : order === 'desc' ? 'DESC' : 'ASC';

/**
 * The S2-T13 order on raw ratings: requested sorts by priority, then the highest raw rating as a
 * price tie-break, then newest publication and listing ID. Only fixed fragments reach the SQL.
 */
export function searchOrderBy(query: TutorSearchQueryDto): Prisma.Sql {
  const sorts: { priority: number; clause: string }[] = [];
  if (query.ratingPriority !== undefined) {
    sorts.push({
      priority: query.ratingPriority,
      clause: `${RATING_KEY.sql} ${direction(query.ratingOrder, 'DESC')} NULLS LAST`,
    });
  }
  if (query.pricePriority !== undefined) {
    sorts.push({
      priority: query.pricePriority,
      clause: `tl."pricePerHour" ${direction(query.priceOrder, 'ASC')}`,
    });
  }
  if (query.availabilityPriority !== undefined) {
    sorts.push({
      priority: query.availabilityPriority,
      clause: `na."nextAvailableAt" ${direction(query.availabilityOrder, 'ASC')} NULLS LAST`,
    });
  }
  sorts.sort((a, b) => a.priority - b.priority);

  const ratingTieBreak =
    query.pricePriority !== undefined && query.ratingPriority === undefined
      ? [`${RATING_KEY.sql} DESC NULLS LAST`]
      : [];
  return Prisma.raw(
    [
      ...sorts.map(({ clause }) => clause),
      ...ratingTieBreak,
      'tl."publishedAt" DESC',
      'tl."id" ASC',
    ].join(', '),
  );
}

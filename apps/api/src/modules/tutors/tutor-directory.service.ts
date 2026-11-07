import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ListingPublicationStatus, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { tutorReviewDisplayAverage } from '@modules/reviews/review-ratings';
import {
  isPublicTutorVerificationStatus,
  publicTutorWhere,
} from '@modules/tutors/public-tutor-access';
import {
  buildTutorRecommendationTags,
  resolveTutorRankingQuery,
  TutorRankingPriority,
} from '@modules/tutors/tutor-ranking';
import {
  RATING_KEY,
  searchConditions,
  searchOrderBy,
  searchSources,
} from '@modules/tutors/tutor-search-query';
import {
  DEFAULT_TUTOR_SEARCH_PAGE,
  DEFAULT_TUTOR_SEARCH_PAGE_SIZE,
} from '@modules/tutors/tutors.dto';

import type { PublicTutorVerificationStatus } from '@modules/tutors/public-tutor-access';
import type { TutorRawRating, TutorRecommendationContext } from '@modules/tutors/tutor-ranking';
import type {
  GradeLevelCatalogResponseDto,
  PublicTeachingListingDto,
  PublicTutorDetailResponseDto,
  SubjectCatalogResponseDto,
  TutorSearchQueryDto,
  TutorSearchResponseDto,
  TutorSearchResultDto,
} from '@modules/tutors/tutors.dto';

const publicListingWhere = {
  deletedAt: null,
  publishedAt: { not: null },
  publicationStatus: ListingPublicationStatus.PUBLISHED,
} satisfies Prisma.TeachingListingWhereInput;

const publicSubjectSelect = {
  active: true,
  code: true,
  id: true,
  name: true,
} satisfies Prisma.SubjectSelect;

const publicGradeLevelSelect = {
  active: true,
  code: true,
  id: true,
  name: true,
  sortOrder: true,
} satisfies Prisma.GradeLevelSelect;

const publicListingSelect = {
  description: true,
  gradeLevel: { select: { name: true } },
  id: true,
  pricePerHour: true,
  subject: { select: { name: true } },
} satisfies Prisma.TeachingListingSelect;

const publicTutorSelect = {
  user: { select: { avatarUpdatedAt: true } },
  bio: true,
  displayName: true,
  experienceYears: true,
  listings: {
    orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    select: publicListingSelect,
    where: publicListingWhere,
  },
  ratingAverage: true,
  reviewCount: true,
  userId: true,
  verificationStatus: true,
} satisfies Prisma.TutorProfileSelect;

// Ratings, review counts and the next slot come from the raw search statement, not this select.
const publicSearchSelect = {
  description: true,
  gradeLevel: { select: { name: true } },
  id: true,
  pricePerHour: true,
  subject: { select: { name: true } },
  tutorProfile: {
    select: {
      user: { select: { avatarUpdatedAt: true } },
      displayName: true,
      experienceYears: true,
      userId: true,
      verificationStatus: true,
    },
  },
} satisfies Prisma.TeachingListingSelect;

type SelectedPublicSearchListing = Prisma.TeachingListingGetPayload<{
  select: typeof publicSearchSelect;
}>;

/** Raw review totals as PostgreSQL returns them; `ratingTotal` is a bigint SUM. */
interface ReviewTotalsRow {
  ratingTotal: bigint;
  reviewCount: number;
}

interface SearchPageRow extends ReviewTotalsRow {
  id: string;
  nextAvailableAt: Date | null;
}

interface SearchSummaryRow {
  total: number;
  lowestPrice: Prisma.Decimal | null;
  earliestAvailableAt: Date | null;
}

function rawRating(row: ReviewTotalsRow): TutorRawRating | null {
  return row.reviewCount === 0
    ? null
    : {
        dimensionTotal: new Prisma.Decimal(row.ratingTotal.toString()),
        reviewCount: row.reviewCount,
      };
}

type SelectedPublicTutor = Prisma.TutorProfileGetPayload<{ select: typeof publicTutorSelect }>;

function isCatalogDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return true;

  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('P')
  );
}

function throwCatalogUnavailable(error: unknown, message: string): never {
  if (isCatalogDatabaseError(error)) throw new ServiceUnavailableException(message);
  throw error;
}

@Injectable()
export class TutorDirectoryService {
  private readonly logger = new Logger(TutorDirectoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async searchPublicTutors(input: TutorSearchQueryDto): Promise<TutorSearchResponseDto> {
    const query = resolveTutorRankingQuery(input);
    const [subject, gradeLevel] = await Promise.all([
      query.subject === undefined
        ? Promise.resolve(null)
        : this.prisma.subject.findFirst({
            where: { active: true, name: { equals: query.subject, mode: 'insensitive' } },
            select: { id: true },
          }),
      query.grade === undefined
        ? Promise.resolve(null)
        : this.prisma.gradeLevel.findFirst({
            where: { active: true, name: { equals: query.grade, mode: 'insensitive' } },
            select: { id: true },
          }),
    ]);

    if (query.subject !== undefined && !subject) {
      throw new BadRequestException('subject is not a supported active catalog value');
    }
    if (query.grade !== undefined && !gradeLevel) {
      throw new BadRequestException('grade is not a supported active catalog value');
    }

    const now = new Date();
    const page = query.page ?? DEFAULT_TUTOR_SEARCH_PAGE;
    const pageSize = query.pageSize ?? DEFAULT_TUTOR_SEARCH_PAGE_SIZE;
    const sources = searchSources(now);
    const conditions = searchConditions({
      ...(subject === null ? {} : { subjectId: subject.id }),
      ...(gradeLevel === null ? {} : { gradeLevelId: gradeLevel.id }),
      ...(query.maxPrice === undefined ? {} : { maxPrice: query.maxPrice }),
      ...(query.minimumRating === undefined ? {} : { minimumRating: query.minimumRating }),
    });

    // One read-only snapshot, so a review committed mid-search cannot make the page, total and
    // tags disagree. Tags are evaluated over the complete matching set, before pagination.
    const { best, listings, rows, summary } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const [summaryRow] = await tx.$queryRaw<SearchSummaryRow[]>(Prisma.sql`
          SELECT COUNT(*)::int AS "total",
            MIN(tl."pricePerHour") AS "lowestPrice",
            MIN(na."nextAvailableAt") AS "earliestAvailableAt"
          FROM ${sources}
          WHERE ${conditions}
        `);
        const [bestRow] =
          query.priority === TutorRankingPriority.HIGHEST_RATING
            ? await tx.$queryRaw<ReviewTotalsRow[]>(Prisma.sql`
                SELECT rt."ratingTotal", rt."reviewCount"
                FROM ${sources}
                WHERE ${conditions} AND rt."reviewCount" > 0
                ORDER BY ${RATING_KEY} DESC
                LIMIT 1
              `)
            : [];
        const pageRows = await tx.$queryRaw<SearchPageRow[]>(Prisma.sql`
          SELECT tl."id", rt."ratingTotal", rt."reviewCount", na."nextAvailableAt"
          FROM ${sources}
          WHERE ${conditions}
          ORDER BY ${searchOrderBy(query)}
          OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
        `);
        const pageListings =
          pageRows.length === 0
            ? []
            : await tx.teachingListing.findMany({
                where: { id: { in: pageRows.map(({ id }) => id) } },
                select: publicSearchSelect,
              });
        return { best: bestRow, listings: pageListings, rows: pageRows, summary: summaryRow };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const recommendationContext: TutorRecommendationContext = {
      earliestAvailableAt:
        query.priority === TutorRankingPriority.EARLIEST_AVAILABILITY
          ? (summary?.earliestAvailableAt ?? null)
          : null,
      highestRating: best === undefined ? null : rawRating(best),
      lowestPrice:
        query.priority === TutorRankingPriority.LOWEST_PRICE
          ? (summary?.lowestPrice ?? null)
          : null,
      ...(query.maxPrice === undefined ? {} : { maxPrice: query.maxPrice }),
    };

    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    const items = rows.flatMap((row) => {
      const listing = byId.get(row.id);
      if (!listing) {
        return [];
      }
      const status = listing.tutorProfile.verificationStatus;
      if (!isPublicTutorVerificationStatus(status)) {
        this.logger.warn(
          `Skipping public listing ${listing.id} with unexpected tutor verification status ${status}`,
        );
        return [];
      }

      return [mapPublicSearchListing(listing, row, status, recommendationContext)];
    });

    const total = summary?.total ?? 0;
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getPublicTutor(tutorId: string): Promise<PublicTutorDetailResponseDto> {
    const tutor = await this.prisma.tutorProfile.findFirst({
      select: publicTutorSelect,
      where: { ...publicTutorWhere, userId: tutorId },
    });

    if (!tutor || !isPublicTutorVerificationStatus(tutor.verificationStatus)) {
      if (tutor) {
        this.logger.warn(
          `Hiding tutor ${tutor.userId} with unexpected verification status ${tutor.verificationStatus}`,
        );
      }
      throw new NotFoundException('Tutor not found');
    }

    return {
      listings: tutor.listings.map(mapPublicDetailListing),
      tutor: mapPublicTutor(tutor, tutor.verificationStatus),
    };
  }

  async getActiveSubjects(): Promise<SubjectCatalogResponseDto> {
    try {
      const items = await this.prisma.subject.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: publicSubjectSelect,
        where: { active: true },
      });

      return { items };
    } catch (error) {
      throwCatalogUnavailable(error, 'Subject catalog is temporarily unavailable');
    }
  }

  async getActiveGradeLevels(): Promise<GradeLevelCatalogResponseDto> {
    try {
      const items = await this.prisma.gradeLevel.findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: publicGradeLevelSelect,
        where: { active: true },
      });

      return { items };
    } catch (error) {
      throwCatalogUnavailable(error, 'GradeLevel catalog is temporarily unavailable');
    }
  }
}

function mapPublicSearchListing(
  listing: SelectedPublicSearchListing,
  row: SearchPageRow,
  verificationStatus: PublicTutorVerificationStatus,
  recommendationContext: TutorRecommendationContext,
): TutorSearchResultDto {
  const tutor = listing.tutorProfile;
  const rating = rawRating(row);
  // Displayed from the same raw totals that filtered and ranked this row (S3-T17 HALF_UP rule).
  const ratingAverage =
    rating === null ? null : tutorReviewDisplayAverage({ ...rating, latestReviewAt: null });

  return {
    recommendationTags: buildTutorRecommendationTags(
      { nextAvailableAt: row.nextAvailableAt, pricePerHour: listing.pricePerHour, rating },
      recommendationContext,
    ),
    avatarUpdatedAt: tutor.user.avatarUpdatedAt,
    description: listing.description,
    displayName: tutor.displayName,
    experienceYears: tutor.experienceYears,
    grade: listing.gradeLevel.name,
    listingId: listing.id,
    nextAvailableAt: row.nextAvailableAt,
    pricePerHour: listing.pricePerHour.toNumber(),
    ratingAverage: ratingAverage?.toNumber() ?? null,
    reviewCount: row.reviewCount,
    subject: listing.subject.name,
    tutorId: tutor.userId,
    verificationStatus,
  };
}

function mapPublicTutor(
  tutor: SelectedPublicTutor,
  verificationStatus: PublicTutorVerificationStatus,
): PublicTutorDetailResponseDto['tutor'] {
  return {
    avatarUpdatedAt: tutor.user.avatarUpdatedAt,
    bio: tutor.bio,
    displayName: tutor.displayName,
    experienceYears: tutor.experienceYears,
    ratingAverage: tutor.ratingAverage?.toNumber() ?? null,
    reviewCount: tutor.reviewCount,
    tutorId: tutor.userId,
    verificationStatus,
  };
}

function mapPublicDetailListing(
  listing: SelectedPublicTutor['listings'][number],
): PublicTeachingListingDto {
  return {
    description: listing.description,
    grade: listing.gradeLevel.name,
    listingId: listing.id,
    pricePerHour: listing.pricePerHour.toNumber(),
    subject: listing.subject.name,
  };
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { BookingStatus, ListingPublicationStatus, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  isPublicTutorVerificationStatus,
  publicTutorWhere,
} from '@modules/tutors/public-tutor-access';
import {
  DEFAULT_TUTOR_SEARCH_PAGE,
  DEFAULT_TUTOR_SEARCH_PAGE_SIZE,
} from '@modules/tutors/tutors.dto';

import type { PublicTutorVerificationStatus } from '@modules/tutors/public-tutor-access';
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

const publicSearchSelect = (now: Date) =>
  ({
    description: true,
    gradeLevel: { select: { name: true } },
    id: true,
    pricePerHour: true,
    subject: { select: { name: true } },
    tutorProfile: {
      select: {
        user: { select: { avatarUpdatedAt: true } },
        availabilitySlots: {
          orderBy: { startAtUtc: 'asc' },
          take: 1,
          where: {
            bookings: {
              none: { status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
            },
            deletedAt: null,
            startAtUtc: { gt: now },
          },
        },
        displayName: true,
        experienceYears: true,
        ratingAverage: true,
        reviewCount: true,
        userId: true,
        verificationStatus: true,
      },
    },
  }) satisfies Prisma.TeachingListingSelect;

type SelectedPublicSearchListing = Prisma.TeachingListingGetPayload<{
  select: ReturnType<typeof publicSearchSelect>;
}>;

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

  async searchPublicTutors(query: TutorSearchQueryDto): Promise<TutorSearchResponseDto> {
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
    const skip = (page - 1) * pageSize;

    const where: Prisma.TeachingListingWhereInput = {
      ...publicListingWhere,
      ...(subject === null ? {} : { subjectId: subject.id }),
      ...(gradeLevel === null ? {} : { gradeLevelId: gradeLevel.id }),
      ...(query.maxPrice === undefined ? {} : { pricePerHour: { lte: query.maxPrice } }),
      tutorProfile: {
        ...publicTutorWhere,
        ...(query.minimumRating === undefined
          ? {}
          : { ratingAverage: { gte: query.minimumRating } }),
      },
    };

    const sortItems: {
      priority: number;
      sqlClause: string;
      prismaOrder?: Prisma.TeachingListingOrderByWithRelationInput;
    }[] = [];

    if (query.ratingPriority !== undefined) {
      const dir = (query.ratingOrder ?? 'desc').toUpperCase();
      sortItems.push({
        priority: query.ratingPriority,
        sqlClause: `tp."ratingAverage" ${dir} NULLS LAST`,
        prismaOrder: { tutorProfile: { ratingAverage: query.ratingOrder ?? 'desc' } },
      });
    }

    if (query.pricePriority !== undefined) {
      const dir = (query.priceOrder ?? 'asc').toUpperCase();
      sortItems.push({
        priority: query.pricePriority,
        sqlClause: `tl."pricePerHour" ${dir}`,
        prismaOrder: { pricePerHour: query.priceOrder ?? 'asc' },
      });
    }

    if (query.availabilityPriority !== undefined) {
      const dir = (query.availabilityOrder ?? 'asc').toUpperCase();
      sortItems.push({
        priority: query.availabilityPriority,
        sqlClause: `MIN(slot."startAtUtc") ${dir} NULLS LAST`,
      });
    }

    sortItems.sort((a, b) => a.priority - b.priority);

    const hasAvailabilitySort = query.availabilityPriority !== undefined;
    let listingIds: string[] = [];

    if (hasAvailabilitySort) {
      const orderClauses = [
        ...sortItems.map((item) => item.sqlClause),
        `tl."publishedAt" DESC`,
        `tl."id" ASC`,
      ].join(', ');

      const rawResults = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT tl.id
        FROM "TeachingListing" tl
        JOIN "TutorProfile" tp ON tl."tutorProfileId" = tp."userId"
        LEFT JOIN "AvailabilitySlot" slot 
          ON slot."tutorProfileId" = tp."userId" 
          AND slot."startAtUtc" >= ${now}
          AND slot."deletedAt" IS NULL
        WHERE tl."publicationStatus" = 'published'::"ListingPublicationStatus"
          AND tl."deletedAt" IS NULL
          ${subject ? Prisma.sql`AND tl."subjectId" = ${subject.id}::uuid` : Prisma.empty}
          ${gradeLevel ? Prisma.sql`AND tl."gradeLevelId" = ${gradeLevel.id}::uuid` : Prisma.empty}
          ${query.maxPrice !== undefined ? Prisma.sql`AND tl."pricePerHour" <= ${query.maxPrice}` : Prisma.empty}
          ${query.minimumRating !== undefined ? Prisma.sql`AND tp."ratingAverage" >= ${query.minimumRating}` : Prisma.empty}
        GROUP BY tl.id, tp."ratingAverage", tl."pricePerHour", tl."publishedAt"
        ORDER BY ${Prisma.raw(orderClauses)}
        OFFSET ${skip} LIMIT ${pageSize}
      `;

      listingIds = rawResults.map((r) => r.id);
    }

    const [listingsRaw, total] = await Promise.all([
      hasAvailabilitySort
        ? listingIds.length > 0
          ? this.prisma.teachingListing.findMany({
              where: { id: { in: listingIds } },
              select: publicSearchSelect(now),
            })
          : Promise.resolve([])
        : this.prisma.teachingListing.findMany({
            where,
            orderBy: [
              ...sortItems.map((item) => item.prismaOrder!),
              { publishedAt: 'desc' },
              { id: 'asc' },
            ],
            select: publicSearchSelect(now),
            skip,
            take: pageSize,
          }),
      this.prisma.teachingListing.count({ where }),
    ]);

    let listings = listingsRaw;
    if (hasAvailabilitySort && listingIds.length > 0) {
      const idMap = new Map(listingsRaw.map((item) => [item.id, item]));
      listings = listingIds.map((id) => idMap.get(id)!).filter(Boolean);
    }

    const items = listings.flatMap((listing) => {
      const status = listing.tutorProfile.verificationStatus;
      if (!isPublicTutorVerificationStatus(status)) {
        this.logger.warn(
          `Skipping public listing ${listing.id} with unexpected tutor verification status ${status}`,
        );
        return [];
      }

      return [mapPublicSearchListing(listing, status)];
    });

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
  verificationStatus: PublicTutorVerificationStatus,
): TutorSearchResultDto {
  const tutor = listing.tutorProfile;

  return {
    avatarUpdatedAt: tutor.user.avatarUpdatedAt,
    description: listing.description,
    displayName: tutor.displayName,
    experienceYears: tutor.experienceYears,
    grade: listing.gradeLevel.name,
    listingId: listing.id,
    nextAvailableAt: tutor.availabilitySlots[0]?.startAtUtc ?? null,
    pricePerHour: listing.pricePerHour.toNumber(),
    ratingAverage: tutor.ratingAverage?.toNumber() ?? null,
    reviewCount: tutor.reviewCount,
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

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  Prisma,
  Role,
  TutorVerificationStatus,
} from '@/generated/prisma/client';

import type {
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingResponseDto,
  ListingStatusRequestDto,
  GradeLevelCatalogResponseDto,
  PublicTeachingListingDto,
  PublicTutorDetailResponseDto,
  SubjectCatalogResponseDto,
  TutorSearchQueryDto,
  TutorSearchResultDto,
} from '@/tutors/tutors.dto';

const listingSelect = {
  createdAt: true,
  description: true,
  gradeLevel: {
    select: {
      active: true,
      code: true,
      id: true,
      name: true,
      sortOrder: true,
    },
  },
  id: true,
  pricePerHour: true,
  publicationStatus: true,
  publishedAt: true,
  subject: {
    select: {
      active: true,
      code: true,
      id: true,
      name: true,
    },
  },
  updatedAt: true,
} satisfies Prisma.TeachingListingSelect;

type SelectedListing = Prisma.TeachingListingGetPayload<{ select: typeof listingSelect }>;

const publicTutorWhere = {
  verificationStatus: TutorVerificationStatus.VERIFIED,
  user: {
    accountStatus: AccountStatus.ACTIVE,
    deletedAt: null,
    role: Role.TUTOR,
  },
} satisfies Prisma.TutorProfileWhereInput;

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
      },
    },
  }) satisfies Prisma.TeachingListingSelect;

type SelectedPublicSearchListing = Prisma.TeachingListingGetPayload<{
  select: ReturnType<typeof publicSearchSelect>;
}>;

type SelectedPublicTutor = Prisma.TutorProfileGetPayload<{ select: typeof publicTutorSelect }>;

function isCatalogDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return true;
  }

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

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025';

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

  async searchPublicTutors(query: TutorSearchQueryDto): Promise<TutorSearchResultDto[]> {
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
    const listings = await this.prisma.teachingListing.findMany({
      select: publicSearchSelect(now),
      where: {
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
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
    });

    return listings.map(mapPublicSearchListing);
  }

  async getPublicTutor(tutorId: string): Promise<PublicTutorDetailResponseDto> {
    const tutor = await this.prisma.tutorProfile.findFirst({
      select: publicTutorSelect,
      where: { ...publicTutorWhere, userId: tutorId },
    });

    if (!tutor) throw new NotFoundException('Tutor not found');

    return {
      listings: tutor.listings.map(mapPublicDetailListing),
      tutor: mapPublicTutor(tutor),
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

  async getListings(userId: string, query: ListingQueryDto): Promise<ListingResponseDto[]> {
    const listings = await this.prisma.teachingListing.findMany({
      select: listingSelect,
      where: {
        tutorProfileId: userId,
        deletedAt: null,
        ...(query.publicationStatus === undefined
          ? {}
          : { publicationStatus: query.publicationStatus }),
      },
      orderBy: { updatedAt: 'desc' },
    });

    return listings.map(mapListing);
  }

  async getListing(userId: string, listingId: string): Promise<ListingResponseDto> {
    const listing = await this.prisma.teachingListing.findFirst({
      select: listingSelect,
      where: {
        id: listingId,
        tutorProfileId: userId,
        deletedAt: null,
      },
    });

    if (!listing) throw new NotFoundException('Listing not found');
    return mapListing(listing);
  }

  async postListing(userId: string, dto: ListingPostRequestDto): Promise<ListingResponseDto> {
    await this.ensureCatalogValues(dto.subjectId, dto.gradeLevelId);

    const listing = await this.prisma.teachingListing.create({
      data: {
        description: dto.description,
        gradeLevelId: dto.gradeLevelId,
        pricePerHour: dto.pricePerHour,
        subjectId: dto.subjectId,
        tutorProfileId: userId,
      },
      select: listingSelect,
    });

    return mapListing(listing);
  }

  async patchListing(
    userId: string,
    listingId: string,
    dto: ListingPatchRequestDto,
  ): Promise<ListingResponseDto> {
    if (dto.subjectId !== undefined || dto.gradeLevelId !== undefined) {
      await this.ensureCatalogValues(dto.subjectId, dto.gradeLevelId);
    }

    try {
      const listing = await this.prisma.teachingListing.update({
        where: {
          id: listingId,
          tutorProfileId: userId,
          deletedAt: null,
        },
        data: dto,
        select: listingSelect,
      });

      return mapListing(listing);
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundException('Listing not found');
      throw error;
    }
  }

  async postPublishListing(userId: string, listingId: string): Promise<ListingResponseDto> {
    const tutorProfile = await this.prisma.tutorProfile.findUnique({
      where: { userId },
      select: { verificationStatus: true },
    });

    if (tutorProfile?.verificationStatus !== TutorVerificationStatus.VERIFIED) {
      throw new ForbiddenException('Tutor is not verified');
    }

    try {
      const listing = await this.prisma.teachingListing.update({
        where: {
          id: listingId,
          tutorProfileId: userId,
          deletedAt: null,
        },
        data: {
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          publishedAt: new Date(),
        },
        select: listingSelect,
      });

      return mapListing(listing);
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundException('Listing not found');
      throw error;
    }
  }

  async updateListingStatus(
    userId: string,
    listingId: string,
    publicationStatus: ListingStatusRequestDto['publicationStatus'],
  ): Promise<ListingResponseDto> {
    if (publicationStatus === ListingPublicationStatus.PUBLISHED) {
      return this.postPublishListing(userId, listingId);
    }

    try {
      const listing = await this.prisma.teachingListing.update({
        where: {
          id: listingId,
          tutorProfileId: userId,
          deletedAt: null,
        },
        data: {
          publicationStatus,
          ...(publicationStatus === ListingPublicationStatus.DRAFT ? { publishedAt: null } : {}),
        },
        select: listingSelect,
      });

      return mapListing(listing);
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundException('Listing not found');
      throw error;
    }
  }

  private async ensureCatalogValues(subjectId?: string, gradeLevelId?: string): Promise<void> {
    const [subject, gradeLevel] = await Promise.all([
      subjectId === undefined
        ? Promise.resolve({ id: '' })
        : this.prisma.subject.findFirst({
            where: { id: subjectId, active: true },
            select: { id: true },
          }),
      gradeLevelId === undefined
        ? Promise.resolve({ id: '' })
        : this.prisma.gradeLevel.findFirst({
            where: { id: gradeLevelId, active: true },
            select: { id: true },
          }),
    ]);

    if (!subject) throw new BadRequestException('subjectId is invalid');
    if (!gradeLevel) throw new BadRequestException('gradeLevelId is invalid');
  }
}

function mapListing(listing: SelectedListing): ListingResponseDto {
  return {
    createdAt: listing.createdAt,
    description: listing.description,
    gradeLevel: listing.gradeLevel,
    id: listing.id,
    pricePerHour: listing.pricePerHour.toNumber(),
    publicationStatus: listing.publicationStatus,
    publishedAt: listing.publishedAt,
    subject: listing.subject,
    updatedAt: listing.updatedAt,
  };
}

function mapPublicSearchListing(listing: SelectedPublicSearchListing): TutorSearchResultDto {
  const tutor = listing.tutorProfile;

  return {
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
  };
}

function mapPublicTutor(tutor: SelectedPublicTutor): PublicTutorDetailResponseDto['tutor'] {
  return {
    bio: tutor.bio,
    displayName: tutor.displayName,
    experienceYears: tutor.experienceYears,
    ratingAverage: tutor.ratingAverage?.toNumber() ?? null,
    reviewCount: tutor.reviewCount,
    tutorId: tutor.userId,
    verificationStatus: 'VERIFIED',
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

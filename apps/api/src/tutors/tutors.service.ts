import {
  BadRequestException,
  ConflictException,
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
import { AvailabilityState } from '@/tutors/tutors.dto';

import type {
  AvailabilityPostRequestDto,
  AvailabilityPostResponseDto,
  AvailabilityPrivateResponseDto,
  AvailabilityPublicResponseDto,
  AvailabilityQueryDto,
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

const activeBookingStatuses: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.CONFIRMED];
const activeBookingWhere = {
  status: { in: activeBookingStatuses },
} satisfies Prisma.BookingWhereInput;

const invalidTimeRange = (message: string): BadRequestException =>
  new BadRequestException({
    code: 'INVALID_TIME_RANGE',
    error: 'Bad Request',
    message,
    statusCode: 400,
  });

const availabilityOverlap = (): ConflictException =>
  new ConflictException({
    code: 'AVAILABILITY_OVERLAP',
    error: 'Conflict',
    message: 'Availability slot overlaps an existing slot',
    statusCode: 409,
  });

const slotNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'SLOT_NOT_FOUND',
    error: 'Not Found',
    message: 'Availability slot not found',
    statusCode: 404,
  });

const slotReserved = (): ConflictException =>
  new ConflictException({
    code: 'SLOT_RESERVED',
    error: 'Conflict',
    message: 'Availability slot has an active booking',
    statusCode: 409,
  });

const tutorNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'TUTOR_NOT_FOUND',
    error: 'Not Found',
    message: 'Verified tutor not found',
    statusCode: 404,
  });

const isConstraintViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === 'P2004') return true;

  return (
    'message' in error &&
    typeof error.message === 'string' &&
    (error.message.includes('AvailabilitySlot_no_overlap_excl') ||
      error.message.includes('AvailabilitySlot_active_booking_delete_check'))
  );
};

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

  //Listing
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

  //Availability
  async getAvailabilityPrivate(
    userId: string,
    query: AvailabilityQueryDto,
  ): Promise<AvailabilityPrivateResponseDto[]> {
    this.validateAvailabilityRange(query);

    const availabilities = await this.prisma.availabilitySlot.findMany({
      select: {
        id: true,
        startAtUtc: true,
        endAtUtc: true,
        createdAt: true,
        bookings: {
          select: { id: true },
          take: 1,
          where: activeBookingWhere,
        },
      },
      where: {
        tutorProfileId: userId,
        deletedAt: null,
        ...this.availabilityRangeWhere(query),
      },
      orderBy: [{ startAtUtc: 'asc' }, { endAtUtc: 'asc' }],
    });

    return availabilities.map((availability) => ({
      id: availability.id,
      startAtUtc: availability.startAtUtc,
      endAtUtc: availability.endAtUtc,
      createdAt: availability.createdAt,
      state: availability.bookings.length > 0 ? AvailabilityState.RESERVED : AvailabilityState.OPEN,
    }));
  }

  async getAvailabilityPublic(
    tutorId: string,
    query: AvailabilityQueryDto,
  ): Promise<AvailabilityPublicResponseDto[]> {
    this.validateAvailabilityRange(query);

    const tutor = await this.prisma.tutorProfile.findFirst({
      select: { userId: true },
      where: {
        userId: tutorId,
        verificationStatus: TutorVerificationStatus.VERIFIED,
      },
    });
    if (!tutor) throw tutorNotFound();

    const now = new Date();
    const from = query.from !== undefined && query.from > now ? query.from : now;

    return this.prisma.availabilitySlot.findMany({
      orderBy: [{ startAtUtc: 'asc' }, { endAtUtc: 'asc' }],
      select: {
        endAtUtc: true,
        id: true,
        startAtUtc: true,
      },
      where: {
        bookings: { none: activeBookingWhere },
        deletedAt: null,
        startAtUtc: {
          gte: from,
          ...(query.to !== undefined && { lt: query.to }),
        },
        tutorProfileId: tutorId,
      },
    });
  }

  async postAvailability(
    userId: string,
    request: AvailabilityPostRequestDto,
  ): Promise<AvailabilityPostResponseDto> {
    if (request.endAt <= request.startAt) {
      throw invalidTimeRange('endAt must be later than startAt');
    }

    if (
      (await this.prisma.availabilitySlot.count({
        where: {
          deletedAt: null,
          endAtUtc: { gt: request.startAt },
          startAtUtc: { lt: request.endAt },
          tutorProfileId: userId,
        },
      })) > 0
    ) {
      throw availabilityOverlap();
    }

    try {
      const availability = await this.prisma.availabilitySlot.create({
        data: {
          endAtUtc: request.endAt,
          startAtUtc: request.startAt,
          tutorProfileId: userId,
        },
      });

      return {
        endAtUtc: availability.endAtUtc,
        id: availability.id,
        startAtUtc: availability.startAtUtc,
        tutorProfileId: availability.tutorProfileId,
      };
    } catch (error) {
      if (isConstraintViolation(error)) throw availabilityOverlap();
      throw error;
    }
  }

  async deleteAvailability(userId: string, slotId: string): Promise<void> {
    const availability = await this.prisma.availabilitySlot.findFirst({
      select: {
        bookings: {
          select: { id: true },
          take: 1,
          where: activeBookingWhere,
        },
      },
      where: {
        deletedAt: null,
        id: slotId,
        tutorProfileId: userId,
      },
    });

    if (!availability) throw slotNotFound();

    if (availability.bookings.length > 0) throw slotReserved();

    try {
      await this.prisma.availabilitySlot.update({
        where: {
          deletedAt: null,
          id: slotId,
          tutorProfileId: userId,
        },
        data: {
          deletedAt: new Date(),
        },
      });
    } catch (error) {
      if (isRecordNotFound(error)) throw slotNotFound();
      if (isConstraintViolation(error)) throw slotReserved();
      throw error;
    }
  }

  private availabilityRangeWhere(query: AvailabilityQueryDto): Prisma.AvailabilitySlotWhereInput {
    if (query.from === undefined && query.to === undefined) return {};

    return {
      startAtUtc: {
        ...(query.from !== undefined && { gte: query.from }),
        ...(query.to !== undefined && { lt: query.to }),
      },
    };
  }

  private validateAvailabilityRange(query: AvailabilityQueryDto): void {
    if (query.from !== undefined && query.to !== undefined && query.to <= query.from) {
      throw invalidTimeRange('to must be later than from');
    }
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

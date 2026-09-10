import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import { BookingStatus, ListingPublicationStatus, TutorVerificationStatus } from '@/generated/prisma/client';

import type { Prisma } from '@/generated/prisma/client';
import {
  AvailabilityPostRequestDto,
  AvailabilityPostResponseDto,
  AvailabilityState,
  type AvailabilityQueryDto,
  type AvailabilityPrivateResponseDto,
  type ListingPatchRequestDto,
  type ListingPostRequestDto,
  type ListingQueryDto,
  type ListingResponseDto,
  AvailabilityPublicResponseDto,
} from '@/tutors/tutors.dto';

const listingSelect = {
  description: true,
  gradeLevel: {
    select: {
      active: true,
      code: true,
      createdAt: true,
      id: true,
      name: true,
      updatedAt: true,
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
      createdAt: true,
      id: true,
      name: true,
      updatedAt: true,
    },
  },
  updatedAt: true,
} satisfies Prisma.TeachingListingSelect;

type SelectedListing = Prisma.TeachingListingGetPayload<{ select: typeof listingSelect }>;

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025';

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

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
  async getAvailabilityPrivate(userId: string, query: AvailabilityQueryDto): Promise<AvailabilityPrivateResponseDto[]> {
    if(query.from !== undefined && query.to !== undefined && query.to <= query.from) {
      throw new BadRequestException(`Invalid range`);
    }

    const availabilities = await this.prisma.availabilitySlot.findMany({
      select: {
        id: true,
        startAtUtc: true,
        endAtUtc: true,
        createdAt: true,
        bookings: {
          select: {
            id: true,
            status: true,
          }
        }
      },
      where: {
        tutorProfileId: userId,
        deletedAt: null,
        ...(query.from !== undefined && {startAtUtc: { gte: query.from }}),
        ...(query.to !== undefined && {endAtUtc: { lte: query.to }}),
      },
    });

    return availabilities.map((availability) => ({
      id: availability.id,
      startAtUtc: availability.startAtUtc,
      endAtUtc: availability.endAtUtc,
      createdAt: availability.createdAt,
      state: (availability.bookings && availability.bookings.length > 0 && availability.bookings.at(0)?.status === BookingStatus.CONFIRMED)? AvailabilityState.RESERVED : AvailabilityState.OPEN,
    }));
  }

  async getAvailabilityPublic(userId: string, query: AvailabilityQueryDto): Promise<AvailabilityPublicResponseDto[]> {
    return (await this.getAvailabilityPrivate(userId, query)).filter(availability => availability.state === AvailabilityState.OPEN).map((availability) => ({
      id: availability.id,
      startAtUtc: availability.startAtUtc,
      endAtUtc: availability.endAtUtc,
    }));
  }

  async postAvailability(userId: string, request: AvailabilityPostRequestDto): Promise<AvailabilityPostResponseDto> {
    if(request.endAtUtc <= request.startAtUtc) {
      throw new BadRequestException(`inverted/equal interval`)
    }

    if(await this.prisma.availabilitySlot.count({
      where:{
        tutorProfileId: userId,
        startAtUtc: { lte: request.endAtUtc },
        endAtUtc: { gte: request.startAtUtc },
      }}) > 0) {
      throw new ConflictException(`Availability slot is overlapping to the others`);
    }

    const availability = await this.prisma.availabilitySlot.create({
      data: {
        tutorProfileId: userId,
        startAtUtc: request.startAtUtc,
        endAtUtc: request.endAtUtc,
      }
    });

    const response: AvailabilityPostResponseDto = {
      id: availability.id,
      tutorProfileId: availability.tutorProfileId,
      startAtUtc: availability.startAtUtc,
      endAtUtc: availability.endAtUtc,
    };

    return response;
  }

  async deleteAvailability(userId: string, slotId: string) {
    const availability = await this.prisma.availabilitySlot.findUniqueOrThrow({
      select: {
        tutorProfileId: true,
        bookings: {
          select: {
            status: true,
          }
        }
      },
      where: {
        id: slotId,
      },
    });

    if(availability.tutorProfileId != userId) {
      throw new NotFoundException(`Not-owned`);
    }

    if(availability.bookings !== undefined && availability.bookings.length > 0 && (availability.bookings.at(0)?.status === BookingStatus.CONFIRMED || availability.bookings.at(0)?.status === BookingStatus.PENDING)) {
      throw new ConflictException(`Active pending/confirmed Booking exists`);
    }

    await this.prisma.availabilitySlot.update({
      where: {
        id: slotId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }
}

function mapListing(listing: SelectedListing): ListingResponseDto {
  return {
    description: listing.description,
    gradeLevel: listing.gradeLevel,
    listingId: listing.id,
    pricePerHour: listing.pricePerHour.toNumber(),
    publicationStatus: listing.publicationStatus,
    publishedAt: listing.publishedAt,
    subject: listing.subject,
    updatedAt: listing.updatedAt,
  };
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import { ListingPublicationStatus, TutorVerificationStatus } from '@/generated/prisma/client';

import type { Prisma } from '@/generated/prisma/client';
import type {
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingResponseDto,
  ListingStatusRequestDto,
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

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025';

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

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

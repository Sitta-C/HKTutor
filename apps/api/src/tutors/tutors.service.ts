import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import {
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingResponseDto,
} from '@/tutors/tutors.dto';

export interface SearchTutorsQuery {
  maxPrice?: number;
  subject?: string;
}

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

  //Listing
  async getListings(
    userid: string,
    request: ListingQueryDto,
  ): Promise<ListingResponseDto[] | null> {
    const listingsToSearch = {
      tutorProfileId: userid,
      deletedAt: null,
      ...(request.publicationStatus !== undefined && {
        publicationStatus: request.publicationStatus,
      }),
    };

    const listings = await this.prisma.teachingListing.findMany({
      select: {
        id: true,
        subject: {
          select: {
            id: true,
            code: true,
            name: true,
            active: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        gradeLevel: {
          select: {
            id: true,
            code: true,
            name: true,
            active: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        pricePerHour: true,
        description: true,
        publicationStatus: true,
        publishedAt: true,
        updatedAt: true,
      },
      where: listingsToSearch,
    });

    return listings.map((listing) => ({
      listingId: listing.id,
      subject: {
        id: listing.subject.id,
        code: listing.subject.code,
        name: listing.subject.name,
        active: listing.subject.active,
        createdAt: new Date(listing.subject.createdAt),
        updatedAt: new Date(listing.subject.updatedAt),
      },
      gradeLevel: {
        id: listing.gradeLevel.id,
        code: listing.gradeLevel.code,
        name: listing.gradeLevel.name,
        active: listing.gradeLevel.active,
        createdAt: new Date(listing.gradeLevel.createdAt),
        updatedAt: new Date(listing.gradeLevel.updatedAt),
      },
      pricePerHour: listing.pricePerHour.toNumber(),
      description: listing.description,
      publicationStatus: listing.publicationStatus,
      publishedAt: listing.publishedAt ? new Date(listing.publishedAt) : null,
      updatedAt: new Date(listing.updatedAt),
    }));
  }

  async postListing(userid: string, request: ListingPostRequestDto): Promise<string> {
    if (!request) {
      throw new NotFoundException(`Catalog value absent`);
    }

    if ((await this.prisma.subject.count({ where: { id: request.subjectId } })) <= 0) {
      throw new BadRequestException(`subjectId is invalid`);
    }

    if ((await this.prisma.gradeLevel.count({ where: { id: request.gradeLevelId } })) <= 0) {
      throw new BadRequestException(`gradeLevelId is invalid`);
    }

    const createListingData = {
      tutorProfileId: userid,
      subjectId: request.subjectId,
      gradeLevelId: request.gradeLevelId,
      pricePerHour: request.pricePerHour,
      description: request.description,
    };

    const newListing = await this.prisma.teachingListing.create({
      data: createListingData,
    });

    return newListing.id;
  }

  async patchListing(
    userid: string,
    listingid: string,
    request: ListingPatchRequestDto,
  ): Promise<ListingResponseDto> {
    const dataToUpdate = {
      ...(request.subjectId !== undefined && { subjectId: request.subjectId }),
      ...(request.gradeLevelId !== undefined && { gradeLevelId: request.gradeLevelId }),
      ...(request.pricePerHour !== undefined && { pricePerHour: request.pricePerHour }),
      ...(request.description !== undefined && { description: request.description }),
    };

    if (
      request.subjectId !== undefined &&
      (await this.prisma.subject.count({ where: { id: request.subjectId } })) <= 0
    ) {
      throw new BadRequestException(`subjectId is invalid`);
    }

    if (
      request.gradeLevelId !== undefined &&
      (await this.prisma.gradeLevel.count({ where: { id: request.gradeLevelId } })) <= 0
    ) {
      throw new BadRequestException(`gradeLevelId is invalid`);
    }

    const updatedListing = await this.prisma.teachingListing.update({
      where: {
        tutorProfileId: userid,
        id: listingid,
        deletedAt: null,
      },
      data: dataToUpdate,
    });

    if (!updatedListing) {
      throw new NotFoundException(`absent/not owned/deleted listing`);
    }

    const responseSubject = await this.prisma.subject.findFirstOrThrow({
      where: {
        id: updatedListing.subjectId,
      },
    });

    const responseGradeLevel = await this.prisma.gradeLevel.findFirstOrThrow({
      where: {
        id: updatedListing.gradeLevelId,
      },
    });

    const response: ListingResponseDto = {
      listingId: updatedListing.id,
      subject: {
        id: responseSubject.id,
        code: responseSubject.code,
        name: responseSubject.name,
        active: responseSubject.active,
        createdAt: new Date(responseSubject.createdAt),
        updatedAt: new Date(responseSubject.updatedAt),
      },
      gradeLevel: {
        id: responseGradeLevel.id,
        code: responseGradeLevel.code,
        name: responseGradeLevel.name,
        active: responseGradeLevel.active,
        createdAt: new Date(responseGradeLevel.createdAt),
        updatedAt: new Date(responseGradeLevel.updatedAt),
      },
      pricePerHour: updatedListing.pricePerHour.toNumber(),
      description: updatedListing.description,
      publicationStatus: updatedListing.publicationStatus,
      publishedAt: updatedListing.publishedAt ? new Date(updatedListing.publishedAt) : null,
      updatedAt: new Date(updatedListing.updatedAt),
    };

    return response;
  }

  async postPublishListing(userid: string, listingid: string): Promise<ListingResponseDto> {
    const tutorProfile = await this.prisma.tutorProfile.findFirst({
      select: {
        verificationStatus: true,
      },
      where: {
        userId: userid,
      },
    });

    if (!tutorProfile || tutorProfile.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException(`Tutor is unverified`);
    }

    const updatedListing = await this.prisma.teachingListing.update({
      where: {
        tutorProfileId: userid,
        id: listingid,
      },
      data: {
        publicationStatus: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    if (!updatedListing) {
      throw new NotFoundException('absent/not-owned listing');
    }

    const responseSubject = await this.prisma.subject.findFirstOrThrow({
      where: {
        id: updatedListing.subjectId,
      },
    });

    const responseGradeLevel = await this.prisma.gradeLevel.findFirstOrThrow({
      where: {
        id: updatedListing.gradeLevelId,
      },
    });

    const response: ListingResponseDto = {
      listingId: updatedListing.id,
      subject: {
        id: responseSubject.id,
        code: responseSubject.code,
        name: responseSubject.name,
        active: responseSubject.active,
        createdAt: new Date(responseSubject.createdAt),
        updatedAt: new Date(responseSubject.updatedAt),
      },
      gradeLevel: {
        id: responseGradeLevel.id,
        code: responseGradeLevel.code,
        name: responseGradeLevel.name,
        active: responseGradeLevel.active,
        createdAt: new Date(responseGradeLevel.createdAt),
        updatedAt: new Date(responseGradeLevel.updatedAt),
      },
      pricePerHour: updatedListing.pricePerHour.toNumber(),
      description: updatedListing.description,
      publicationStatus: updatedListing.publicationStatus,
      publishedAt: updatedListing.publishedAt ? new Date(updatedListing.publishedAt) : null,
      updatedAt: new Date(updatedListing.updatedAt),
    };

    return response;
  }
}

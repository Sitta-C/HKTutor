import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import {
  AccountStatus,
  ListingPublicationStatus,
  TutorVerificationStatus,
} from '@/generated/prisma/enums';
import { TutorResponseDto, TutorProfileResponseDto } from '@/tutors/tutors.dto';

export interface SearchTutorsQuery {
  maxPrice?: number;
  subject?: string;
}

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchTutorsQuery): Promise<TutorResponseDto[]> {
    const listings = await this.prisma.teachingListing.findMany({
      select: {
        gradeLevel: { select: { name: true } },
        id: true,
        pricePerHour: true,
        subject: { select: { name: true } },
        tutorProfile: {
          select: {
            displayName: true,
            ratingAverage: true,
          },
        },
      },
      where: {
        deletedAt: null,
        ...(query.maxPrice === undefined ? {} : { pricePerHour: { lte: query.maxPrice } }),
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        subject: {
          is: {
            active: true,
            ...(query.subject === undefined
              ? {}
              : { name: { equals: query.subject, mode: 'insensitive' as const } }),
          },
        },
        tutorProfile: {
          is: {
            user: {
              is: {
                accountStatus: AccountStatus.ACTIVE,
                deletedAt: null,
              },
            },
            verificationStatus: TutorVerificationStatus.VERIFIED,
          },
        },
      },
    });

    return listings.map((listing) => ({
      displayName: listing.tutorProfile.displayName,
      grade: listing.gradeLevel.name,
      id: listing.id,
      pricePerHour: listing.pricePerHour.toNumber(),
      rating: listing.tutorProfile.ratingAverage?.toNumber() ?? null,
      subject: listing.subject.name,
    }));
  }

  async getProfile(userid: string): Promise<TutorProfileResponseDto> {
    const profile = await this.prisma.tutorProfile.findFirst({
      select: {
        userId: true,
        displayName: true,
        bio: true,
        experienceYears: true,
        verificationStatus: true,
        ratingAverage: true,
        reviewCount: true,
      },
      where: {
        userId: userid,
      },
    });

    if(!profile) {
      throw new NotFoundException(`Profile not found`);
    }

    const response: TutorProfileResponseDto = {
      userId: profile.userId,
      displayName: profile.displayName,
      bio: profile.bio,
      experienceYears: profile.experienceYears,
      verificationStatus: profile.verificationStatus,
      ratingAverage: profile.ratingAverage?.toDecimalPlaces(1).toNumber() || null,
      reviewCount: profile.reviewCount
    }

    return response;
  }
}

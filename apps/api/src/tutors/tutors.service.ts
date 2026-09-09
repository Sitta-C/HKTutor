import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import { ListingQueryDto, ListingResponseDto, TutorProfileResponseDto, TutorProfileUpdateQueryDto } from '@/tutors/tutors.dto';

export interface SearchTutorsQuery {
  maxPrice?: number;
  subject?: string;
}

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

  //Profile
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
      throw new NotFoundException(`Profile absent`);
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

  async putProfile(userid: string, query: TutorProfileUpdateQueryDto) {
    const dataToUpdate = {
      displayName: query.displayName,
      ...(query.bio !== undefined && { bio: query.bio }),
      ...(query.experienceYears !== undefined && {experienceYears: query.experienceYears}) 
    }

    const updatedProfile = await this.prisma.tutorProfile.update({
      where: {
        userId: userid,
      },
      data: dataToUpdate,
    });

    return updatedProfile;
  }

  //Listing
  async getListings(userid: string, query: ListingQueryDto): Promise<ListingResponseDto[] | null> {
    const listingsToSearch = {
      userid: userid,
      ...(query.publicationStatus !== undefined && {publicationStatus: query.publicationStatus})
    }

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
          }
        },
        gradeLevel: {
          select: {
            id: true,
            code: true,
            name: true,
            active: true,
            createdAt: true,
            updatedAt: true,
          }
        },
        pricePerHour: true,
        description: true,
        publicationStatus: true,
        publishedAt: true,
        updatedAt: true,
      },
      where: listingsToSearch
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
      publishedAt: (listing.publishedAt)? new Date(listing.publishedAt) : null,
      updatedAt: new Date(listing.updatedAt),
    }));
  }

}

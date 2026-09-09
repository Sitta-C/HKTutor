import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import { TutorProfileResponseDto, TutorProfileUpdateQueryDto } from '@/tutors/tutors.dto';

export interface SearchTutorsQuery {
  maxPrice?: number;
  subject?: string;
}

@Injectable()
export class TutorsService {
  constructor(private readonly prisma: PrismaService) {}

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
}

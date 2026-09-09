import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { CURRENT_PRIVACY_POLICY_VERSION } from '@/auth/auth.constants';
import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { Prisma } from '@/generated/prisma/client';
import type { SaveStudentProfileDto, SaveTutorProfileDto } from '@/profiles/profiles.dto';

const studentProfileSelect: Prisma.StudentProfileSelect = {
  firstName: true,
  gradeLevel: true,
  lastName: true,
  nickname: true,
  phone: true,
  school: true,
};

const tutorProfileSelect: Prisma.TutorProfileSelect = {
  bio: true,
  displayName: true,
  experienceYears: true,
  firstName: true,
  lastName: true,
  nickname: true,
  ratingAverage: true,
  reviewCount: true,
  verificationStatus: true,
};

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(user: AuthenticatedUser) {
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        policyVersion: true,
        studentProfile: { select: studentProfileSelect },
        tutorProfile: { select: tutorProfileSelect },
      },
    });

    if (!account) throw new NotFoundException('Account not found');

    const consentCurrent = account.policyVersion === CURRENT_PRIVACY_POLICY_VERSION;
    if (user.role === Role.STUDENT) {
      return {
        consentCurrent,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        profile: account.studentProfile,
        profileComplete: account.studentProfile !== null,
        role: Role.STUDENT,
      };
    }

    if (user.role === Role.TUTOR) {
      const profile = account.tutorProfile;
      const profileComplete = Boolean(
        profile?.firstName?.trim() && profile.lastName?.trim() && profile.nickname?.trim(),
      );
      return {
        consentCurrent,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        profile,
        profileComplete,
        role: Role.TUTOR,
      };
    }

    return {
      consentCurrent: true,
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      profile: null,
      profileComplete: true,
      role: Role.ADMIN,
    };
  }

  async saveStudent(userId: string, dto: SaveStudentProfileDto) {
    await this.ensureCurrentConsent(userId);

    return this.prisma.studentProfile.upsert({
      where: { userId },
      update: dto,
      create: { userId, ...dto },
      select: studentProfileSelect,
    });
  }

  async saveTutor(userId: string, dto: SaveTutorProfileDto) {
    await this.ensureCurrentConsent(userId);

    return this.prisma.tutorProfile.upsert({
      where: { userId },
      update: dto,
      create: {
        userId,
        ...dto,
      },
      select: tutorProfileSelect,
    });
  }

  private async ensureCurrentConsent(userId: string): Promise<void> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { policyVersion: true },
    });
    if (account?.policyVersion !== CURRENT_PRIVACY_POLICY_VERSION) {
      throw new BadRequestException('Accept the current privacy notice before saving a profile');
    }
  }
}
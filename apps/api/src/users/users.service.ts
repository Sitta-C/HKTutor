import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';

import type { OnboardingConsentDto, OnboardingRole } from '@/users/users.dto';

const ONBOARDING_ROLE_MAP: Record<OnboardingRole, Role> = {
  student: Role.STUDENT,
  tutor: Role.TUTOR,
};

export interface OnboardingConsentResult {
  created: boolean;
  role: Role;
  consentAcceptedAt: Date;
  policyVersion: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getCleckUserID(userID: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      select: {
        clerkUserId: true,
      },
      where: {
        id: userID,
        deletedAt: null,
      },
    });

    if (!user) return null;

    return user.clerkUserId;
  }

  async completeOnboarding(
    clerkUserId: string,
    dto: OnboardingConsentDto,
  ): Promise<OnboardingConsentResult> {
    if (!dto.consent) {
      throw new BadRequestException('Consent must be accepted to complete onboarding');
    }

    const role = ONBOARDING_ROLE_MAP[dto.role];

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { clerkUserId } });

      if (existing?.deletedAt) {
        throw new ConflictException('This account can no longer be onboarded');
      }

      if (existing) {
        if (existing.consentAcceptedAt && existing.policyVersion) {
          if (existing.role !== role) {
            throw new ConflictException('This account already onboarded with a different role');
          }

          return {
            consentAcceptedAt: existing.consentAcceptedAt,
            created: false,
            policyVersion: existing.policyVersion,
            role: existing.role,
          };
        }

        const updated = await tx.user.update({
          data: {
            consentAcceptedAt: new Date(),
            policyVersion: dto.policyVersion,
            role,
          },
          where: { id: existing.id },
        });

        return {
          consentAcceptedAt: updated.consentAcceptedAt,
          created: false,
          policyVersion: dto.policyVersion,
          role: updated.role,
        };
      }

      const created = await tx.user.create({
        data: {
          clerkUserId,
          consentAcceptedAt: new Date(),
          policyVersion: dto.policyVersion,
          role,
        },
      });

      return {
        consentAcceptedAt: created.consentAcceptedAt,
        created: true,
        policyVersion: dto.policyVersion,
        role: created.role,
      };
    });
  }
}

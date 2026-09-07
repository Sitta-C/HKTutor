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

    const readExisting = (user: {
      clerkUserId: string;
      consentAcceptedAt: Date | null;
      deletedAt: Date | null;
      id: string;
      policyVersion: string | null;
      role: Role;
    }): OnboardingConsentResult => {
      if (user.deletedAt) {
        throw new ConflictException('This account can no longer be onboarded');
      }

      if (user.role !== role) {
        throw new ConflictException('This account already exists with a different role');
      }

      if (user.consentAcceptedAt && user.policyVersion) {
        return {
          consentAcceptedAt: user.consentAcceptedAt,
          created: false,
          policyVersion: user.policyVersion,
          role: user.role,
        };
      }

      return {
        consentAcceptedAt: user.consentAcceptedAt ?? new Date(),
        created: false,
        policyVersion: user.policyVersion ?? '',
        role: user.role,
      };
    };

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { clerkUserId } });

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

        if (existing.deletedAt) {
          throw new ConflictException('This account can no longer be onboarded');
        }

        if (existing.role !== role) {
          throw new ConflictException('This account already exists with a different role');
        }

        const consentAcceptedAt = new Date();
        await tx.user.update({
          data: {
            consentAcceptedAt,
            policyVersion: dto.policyVersion,
          },
          where: { id: existing.id },
        });

        return {
          consentAcceptedAt,
          created: false,
          policyVersion: dto.policyVersion,
          role: existing.role,
        };
      }

      const consentAcceptedAt = new Date();
      const created = await tx.user
        .create({
          data: {
            clerkUserId,
            consentAcceptedAt,
            policyVersion: dto.policyVersion,
            role,
          },
        })
        .then(
          (row): { created: true } & OnboardingConsentResult => ({
            consentAcceptedAt: row.consentAcceptedAt ?? consentAcceptedAt,
            created: true,
            policyVersion: row.policyVersion ?? dto.policyVersion,
            role: row.role,
          }),
        )
        .catch(async (error: unknown): Promise<OnboardingConsentResult> => {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as { code?: unknown }).code === 'P2002'
          ) {
            // Concurrent duplicate onboarding: the winner's row is committed by
            // another transaction, so re-read inside this transaction and treat
            // this request as a retry of that outcome.
            const winner = await tx.user.findUnique({ where: { clerkUserId } });

            if (winner) {
              return readExisting(winner);
            }
          }

          throw error;
        });

      return created;
    });
  }
}

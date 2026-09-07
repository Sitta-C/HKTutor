import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';

import type { Prisma } from '@/generated/prisma/client';
import type { OnboardingConsentDto, OnboardingRole } from '@/users/users.dto';

const ONBOARDING_ROLE_MAP: Record<OnboardingRole, Role> = {
  student: Role.STUDENT,
  tutor: Role.TUTOR,
};

type OnboardingTx = Prisma.TransactionClient;

type ExistingUser = {
  clerkUserId: string;
  consentAcceptedAt: Date | null;
  deletedAt: Date | null;
  id: string;
  policyVersion: string | null;
  role: Role;
};

export interface OnboardingConsentResult {
  created: boolean;
  role: Role;
  consentAcceptedAt: Date;
  policyVersion: string;
}

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

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

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.user.findUnique({ where: { clerkUserId } });

        if (existing) {
          return this.applyOnboardingState(tx, existing, role, dto.policyVersion);
        }

        return this.createOnboardedUser(tx, clerkUserId, role, dto.policyVersion);
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;

      // PostgreSQL aborted the first transaction after the P2002 violation, so the
      // committed winner must be re-read through a SECOND, fresh transaction.
      return this.prisma.$transaction(async (tx) => {
        const winner = await tx.user.findUnique({ where: { clerkUserId } });

        if (!winner) throw error;

        return this.applyOnboardingState(tx, winner, role, dto.policyVersion);
      });
    }
  }

  private async applyOnboardingState(
    tx: OnboardingTx,
    user: ExistingUser,
    role: Role,
    policyVersion: string,
  ): Promise<OnboardingConsentResult> {
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

    const consentAcceptedAt = new Date();
    await tx.user.update({
      data: {
        consentAcceptedAt,
        policyVersion,
      },
      where: { id: user.id },
    });

    return {
      consentAcceptedAt,
      created: false,
      policyVersion,
      role: user.role,
    };
  }

  private async createOnboardedUser(
    tx: OnboardingTx,
    clerkUserId: string,
    role: Role,
    policyVersion: string,
  ): Promise<OnboardingConsentResult> {
    const consentAcceptedAt = new Date();
    const created = await tx.user.create({
      data: {
        clerkUserId,
        consentAcceptedAt,
        policyVersion,
        role,
      },
    });

    return {
      consentAcceptedAt: created.consentAcceptedAt ?? consentAcceptedAt,
      created: true,
      policyVersion: created.policyVersion ?? policyVersion,
      role: created.role,
    };
  }
}

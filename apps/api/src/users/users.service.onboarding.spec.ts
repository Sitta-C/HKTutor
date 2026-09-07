import { BadRequestException, ConflictException } from '@nestjs/common';

import { Role } from '@/generated/prisma/client';
import { UsersService } from '@/users/users.service';

import type { PrismaService } from '@/database/prisma.service';

const buildPrisma = () => {
  const txMock = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((operation: (tx: typeof txMock) => Promise<unknown>) =>
      operation(txMock),
    ),
  };

  return { prisma, txMock };
};

describe('UsersService.completeOnboarding', () => {
  it('creates a new consented user with the mapped student role inside exactly one transaction', async () => {
    const { prisma, txMock } = buildPrisma();
    txMock.user.findUnique.mockResolvedValue(null);
    const acceptedAt = new Date('2026-08-01T10:00:00Z');
    txMock.user.create.mockResolvedValue({
      clerkUserId: 'clerk_new',
      consentAcceptedAt: acceptedAt,
      id: 'user-1',
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_new', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).resolves.toMatchObject({
      consentAcceptedAt: acceptedAt,
      created: true,
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });

    expect(txMock.user.create).toHaveBeenCalledTimes(1);
    const [createCall] = txMock.user.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createCall.data).toMatchObject({
      clerkUserId: 'clerk_new',
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });
    expect(createCall.data['consentAcceptedAt']).toBeInstanceOf(Date);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('maps the tutor role to the Prisma enum', async () => {
    const { prisma, txMock } = buildPrisma();
    txMock.user.findUnique.mockResolvedValue(null);
    txMock.user.create.mockResolvedValue({
      clerkUserId: 'clerk_tutor',
      consentAcceptedAt: new Date(),
      id: 'user-2',
      policyVersion: '2026-08-01',
      role: Role.TUTOR,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await service.completeOnboarding('clerk_tutor', {
      consent: true,
      policyVersion: '2026-08-01',
      role: 'tutor',
    });

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: Role.TUTOR }) as unknown,
    });
  });

  it('conflicts when a provisioned user without consent onboards with a different role', async () => {
    const { prisma, txMock } = buildPrisma();
    txMock.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_existing',
      consentAcceptedAt: null,
      deletedAt: null,
      id: 'user-3',
      policyVersion: null,
      role: Role.STUDENT,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_existing', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'tutor',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.user.create).not.toHaveBeenCalled();
  });

  it('updates only consent fields when a provisioned user onboards with the matching role', async () => {
    const { prisma, txMock } = buildPrisma();
    txMock.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_existing',
      consentAcceptedAt: null,
      deletedAt: null,
      id: 'user-3',
      policyVersion: null,
      role: Role.STUDENT,
    });
    const acceptedAt = new Date('2026-08-01T11:00:00Z');
    txMock.user.update.mockResolvedValue({
      clerkUserId: 'clerk_existing',
      consentAcceptedAt: acceptedAt,
      id: 'user-3',
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_existing', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).resolves.toMatchObject({ created: false, role: Role.STUDENT });

    expect(txMock.user.update).toHaveBeenCalledTimes(1);
    const updateCall = txMock.user.update.mock.calls[0]?.[0];
    expect(updateCall.data).not.toHaveProperty('role');
    expect(txMock.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('treats a concurrent duplicate create as an idempotent retry of the winner', async () => {
    const { prisma, txMock } = buildPrisma();
    const acceptedAt = new Date('2026-08-01T12:00:00Z');
    txMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        clerkUserId: 'clerk_race',
        consentAcceptedAt: acceptedAt,
        deletedAt: null,
        id: 'user-7',
        policyVersion: '2026-08-01',
        role: Role.STUDENT,
      });
    txMock.user.create.mockRejectedValue({ code: 'P2002' });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_race', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).resolves.toMatchObject({
      consentAcceptedAt: acceptedAt,
      created: false,
      role: Role.STUDENT,
    });

    expect(txMock.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when the same role retries after consent (no create or update)', async () => {
    const { prisma, txMock } = buildPrisma();
    const acceptedAt = new Date('2026-08-01T09:00:00Z');
    txMock.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_retry',
      consentAcceptedAt: acceptedAt,
      deletedAt: null,
      id: 'user-4',
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_retry', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).resolves.toMatchObject({
      consentAcceptedAt: acceptedAt,
      created: false,
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });

    expect(txMock.user.create).not.toHaveBeenCalled();
    expect(txMock.user.update).not.toHaveBeenCalled();
  });

  it('conflicts when an already-consented user retries with a different role', async () => {
    const { prisma, txMock } = buildPrisma();
    txMock.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_switch',
      consentAcceptedAt: new Date('2026-08-01T09:00:00Z'),
      deletedAt: null,
      id: 'user-5',
      policyVersion: '2026-08-01',
      role: Role.TUTOR,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_switch', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(txMock.user.create).not.toHaveBeenCalled();
    expect(txMock.user.update).not.toHaveBeenCalled();
  });

  it('conflicts when the matching user is soft-deleted', async () => {
    const { prisma, txMock } = buildPrisma();
    txMock.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_deleted',
      consentAcceptedAt: null,
      deletedAt: new Date('2026-07-01T00:00:00Z'),
      id: 'user-6',
      policyVersion: null,
      role: Role.STUDENT,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_deleted', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(txMock.user.create).not.toHaveBeenCalled();
    expect(txMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a declined consent before opening any transaction', async () => {
    const { prisma, txMock } = buildPrisma();
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_declined', {
        consent: false,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txMock.user.findUnique).not.toHaveBeenCalled();
    expect(txMock.user.create).not.toHaveBeenCalled();
    expect(txMock.user.update).not.toHaveBeenCalled();
  });
});

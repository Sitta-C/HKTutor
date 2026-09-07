import { BadRequestException, ConflictException } from '@nestjs/common';

import { Role } from '@/generated/prisma/client';
import { UsersService } from '@/users/users.service';

import type { PrismaService } from '@/database/prisma.service';

type TxMock = {
  user: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

const buildTxMock = (): TxMock => ({
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
});

const buildPrisma = () => {
  const txMock1 = buildTxMock();
  const txMock2 = buildTxMock();
  let call = 0;
  const prisma = {
    $transaction: jest.fn((operation: (tx: TxMock) => Promise<unknown>) => {
      call += 1;
      return operation(call === 1 ? txMock1 : txMock2);
    }),
  };

  return { prisma, txMock1, txMock2 };
};

describe('UsersService.completeOnboarding', () => {
  it('creates a new consented user with the mapped student role inside exactly one transaction', async () => {
    const { prisma, txMock1 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue(null);
    const acceptedAt = new Date('2026-08-01T10:00:00Z');
    txMock1.user.create.mockResolvedValue({
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

    expect(txMock1.user.create).toHaveBeenCalledTimes(1);
    const [createCall] = txMock1.user.create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(createCall.data).toMatchObject({
      clerkUserId: 'clerk_new',
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });
    expect(createCall.data['consentAcceptedAt']).toBeInstanceOf(Date);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('maps the tutor role to the Prisma enum', async () => {
    const { prisma, txMock1 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue(null);
    txMock1.user.create.mockResolvedValue({
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

    expect(txMock1.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: Role.TUTOR }) as unknown,
    });
  });

  it('conflicts when a provisioned user without consent onboards with a different role', async () => {
    const { prisma, txMock1 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue({
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

    expect(txMock1.user.update).not.toHaveBeenCalled();
    expect(txMock1.user.create).not.toHaveBeenCalled();
  });

  it('updates only consent fields when a provisioned user onboards with the matching role', async () => {
    const { prisma, txMock1 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_existing',
      consentAcceptedAt: null,
      deletedAt: null,
      id: 'user-3',
      policyVersion: null,
      role: Role.STUDENT,
    });
    const acceptedAt = new Date('2026-08-01T11:00:00Z');
    txMock1.user.update.mockResolvedValue({
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

    expect(txMock1.user.update).toHaveBeenCalledTimes(1);
    const updateCalls = txMock1.user.update.mock.calls as unknown as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(updateCalls[0]?.[0].data).not.toHaveProperty('role');
    expect(txMock1.user.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('recovers from a concurrent create by re-reading the committed winner through a second transaction', async () => {
    const { prisma, txMock1, txMock2 } = buildPrisma();
    const acceptedAt = new Date('2026-08-01T12:00:00Z');
    txMock1.user.findUnique.mockResolvedValue(null);
    txMock1.user.create.mockRejectedValue({ code: 'P2002' });
    txMock2.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_race',
      consentAcceptedAt: acceptedAt,
      deletedAt: null,
      id: 'user-7',
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });
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
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });

    expect(txMock1.user.create).toHaveBeenCalledTimes(1);
    expect(txMock2.user.findUnique).toHaveBeenCalledTimes(1);
    expect(txMock2.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('pins that the re-read after a P2002 only happens in the second transaction', async () => {
    const { prisma, txMock1, txMock2 } = buildPrisma();
    const acceptedAt = new Date('2026-08-01T12:00:00Z');
    txMock1.user.findUnique.mockResolvedValue(null);
    txMock1.user.create.mockRejectedValue({ code: 'P2002' });
    txMock2.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_race',
      consentAcceptedAt: acceptedAt,
      deletedAt: null,
      id: 'user-7',
      policyVersion: '2026-08-01',
      role: Role.STUDENT,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await service.completeOnboarding('clerk_race', {
      consent: true,
      policyVersion: '2026-08-01',
      role: 'student',
    });

    expect(txMock1.user.findUnique).toHaveBeenCalledTimes(1);
    expect(txMock2.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('backfills consent through the second transaction when the winner is provisioned without consent', async () => {
    const { prisma, txMock1, txMock2 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue(null);
    txMock1.user.create.mockRejectedValue({ code: 'P2002' });
    txMock2.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_race',
      consentAcceptedAt: null,
      deletedAt: null,
      id: 'user-7',
      policyVersion: null,
      role: Role.STUDENT,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_race', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).resolves.toMatchObject({ created: false, role: Role.STUDENT });

    expect(txMock2.user.update).toHaveBeenCalledTimes(1);
    const [updateCall] = txMock2.user.update.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(updateCall.data).toEqual({
      consentAcceptedAt: expect.any(Date) as unknown,
      policyVersion: '2026-08-01',
    });
    expect(updateCall.data).not.toHaveProperty('role');
  });

  it('conflicts through the second transaction when the committed winner has a different role', async () => {
    const { prisma, txMock1, txMock2 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue(null);
    txMock1.user.create.mockRejectedValue({ code: 'P2002' });
    txMock2.user.findUnique.mockResolvedValue({
      clerkUserId: 'clerk_race',
      consentAcceptedAt: null,
      deletedAt: null,
      id: 'user-7',
      policyVersion: null,
      role: Role.TUTOR,
    });
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_race', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(txMock2.user.update).not.toHaveBeenCalled();
  });

  it('rethrows the P2002 error when the committed winner cannot be re-read in the second transaction', async () => {
    const { prisma, txMock1, txMock2 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue(null);
    txMock1.user.create.mockRejectedValue({ code: 'P2002' });
    txMock2.user.findUnique.mockResolvedValue(null);
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_race', {
        consent: true,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(txMock2.user.update).not.toHaveBeenCalled();
  });

  it('is idempotent when the same role retries after consent (no create or update)', async () => {
    const { prisma, txMock1 } = buildPrisma();
    const acceptedAt = new Date('2026-08-01T09:00:00Z');
    txMock1.user.findUnique.mockResolvedValue({
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

    expect(txMock1.user.create).not.toHaveBeenCalled();
    expect(txMock1.user.update).not.toHaveBeenCalled();
  });

  it('conflicts when an already-consented user retries with a different role', async () => {
    const { prisma, txMock1 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue({
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

    expect(txMock1.user.create).not.toHaveBeenCalled();
    expect(txMock1.user.update).not.toHaveBeenCalled();
  });

  it('conflicts when the matching user is soft-deleted', async () => {
    const { prisma, txMock1 } = buildPrisma();
    txMock1.user.findUnique.mockResolvedValue({
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

    expect(txMock1.user.create).not.toHaveBeenCalled();
    expect(txMock1.user.update).not.toHaveBeenCalled();
  });

  it('rejects a declined consent before opening any transaction', async () => {
    const { prisma, txMock1 } = buildPrisma();
    const service = new UsersService(prisma as unknown as PrismaService);

    await expect(
      service.completeOnboarding('clerk_declined', {
        consent: false,
        policyVersion: '2026-08-01',
        role: 'student',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txMock1.user.findUnique).not.toHaveBeenCalled();
    expect(txMock1.user.create).not.toHaveBeenCalled();
    expect(txMock1.user.update).not.toHaveBeenCalled();
  });
});

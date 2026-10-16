import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AuthConfigService } from '@config/auth.config';
import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { AuthService } from '@modules/auth/auth.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { PasswordService } from '@modules/auth/password.service';

const NOW = new Date('2026-10-16T08:00:00Z');
const TOKEN = 'a'.repeat(43);
const REQUEST = { email: 'student@example.com' };
const RESET = { token: TOKEN, password: 'new-password123' };
const GENERIC_MESSAGE = 'If the account is eligible, a password reset email will be sent.';
const INVALID_LINK = 'Password reset link is invalid or expired';

async function harness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-id' }]),
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'user-id', email: REQUEST.email }),
      update: jest.fn().mockResolvedValue({ id: 'user-id' }),
    },
    passwordResetToken: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'reset-id' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    emailVerificationToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'verification-id' }),
    },
    authSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      create: jest.fn().mockResolvedValue({ id: 'session-id' }),
    },
  };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-id' }) },
    emailVerificationToken: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'verification-id',
        userId: 'user-id',
        consumedAt: null,
        expiresAt: new Date(NOW.getTime() + 60_000),
        user: {
          id: 'user-id',
          email: REQUEST.email,
          role: Role.STUDENT,
          deletedAt: null,
          accountStatus: AccountStatus.ACTIVE,
          emailVerifiedAt: null,
        },
      }),
    },
    passwordResetToken: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'reset-id',
        userId: 'user-id',
        consumedAt: null,
        expiresAt: new Date(NOW.getTime() + 60_000),
      }),
    },
    $transaction: jest.fn((operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
  };
  const email = {
    sendVerificationEmail: jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined),
  };
  const passwords = {
    hash: jest.fn().mockResolvedValue('new-argon2id-hash'),
    verify: jest.fn().mockResolvedValue(true),
  };
  const jwt = {
    signAccessToken: jest.fn().mockReturnValue('access'),
    signRefreshToken: jest.fn().mockReturnValue('refresh'),
  };
  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: EmailService, useValue: email },
      { provide: PasswordService, useValue: passwords },
      { provide: JwtTokenService, useValue: jwt },
      {
        provide: AuthConfigService,
        useValue: { passwordResetTtlMinutes: 30, accessTtlSeconds: 900, refreshTtlSeconds: 604800 },
      },
    ],
  }).compile();
  return { service: module.get(AuthService), prisma, tx, email, passwords, jwt };
}

describe('password reset', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stores only a hash, expires in 30 minutes and emails the raw token after commit', async () => {
    const { service, prisma, tx, email } = await harness();
    await expect(service.forgotPassword(REQUEST)).resolves.toEqual({ message: GENERIC_MESSAGE });
    await jest.advanceTimersByTimeAsync(0);
    const token: unknown = email.sendPasswordResetEmail.mock.calls[0]?.[1];
    expect(typeof token).toBe('string');
    if (typeof token !== 'string') {
      throw new Error('Missing email token');
    }
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.passwordResetToken.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date('2026-10-16T08:30:00Z'),
      },
    });
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', consumedAt: null },
      data: { consumedAt: NOW },
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: REQUEST.email,
          deletedAt: null,
          accountStatus: 'ACTIVE',
          emailVerifiedAt: { not: null },
          passwordHash: { not: null },
        },
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.passwordResetToken.create.mock.invocationCallOrder[0]).toBeLessThan(
      email.sendPasswordResetEmail.mock.invocationCallOrder[0] ?? 0,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('returns the same response for an unknown or ineligible account', async () => {
    const { service, prisma, email } = await harness();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.forgotPassword(REQUEST)).resolves.toEqual({ message: GENERIC_MESSAGE });
    await jest.advanceTimersByTimeAsync(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it.each(['account changed while waiting', 'per-account cooldown'])(
    'silently skips delivery for %s',
    async (reason) => {
      const { service, tx, email } = await harness();
      if (reason === 'per-account cooldown') {
        tx.passwordResetToken.findFirst.mockResolvedValue({ id: 'recent-id' });
      } else {
        tx.user.findFirst.mockResolvedValue(null);
      }
      await expect(service.forgotPassword(REQUEST)).resolves.toEqual({ message: GENERIC_MESSAGE });
      await jest.advanceTimersByTimeAsync(0);
      expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    },
  );

  it('does not wait for the email provider or disclose its failures', async () => {
    const { service, email } = await harness();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let rejectDelivery: (reason: Error) => void = () => undefined;
    email.sendPasswordResetEmail.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDelivery = reject;
        }),
    );
    await expect(service.forgotPassword(REQUEST)).resolves.toEqual({ message: GENERIC_MESSAGE });
    await jest.advanceTimersByTimeAsync(0);
    rejectDelivery(new Error('private-provider-details'));
    await jest.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith('Password reset request processing failed');
  });

  it('returns before account lookup completes so response timing does not expose eligibility', async () => {
    const { service, prisma, email } = await harness();
    let finishLookup: () => void = () => undefined;
    prisma.user.findFirst.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLookup = () => resolve(null);
        }),
    );
    await expect(service.forgotPassword(REQUEST)).resolves.toEqual({ message: GENERIC_MESSAGE });
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    finishLookup();
    await jest.advanceTimersByTimeAsync(0);
  });

  it('keeps database failures private and does not send a link that was not persisted', async () => {
    const { service, prisma, email } = await harness();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.$transaction.mockRejectedValueOnce(new Error('private database details'));
    await expect(service.forgotPassword(REQUEST)).resolves.toEqual({ message: GENERIC_MESSAGE });
    await jest.advanceTimersByTimeAsync(0);
    expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Password reset request processing failed');
  });

  it('serializes verification resend and enforces the account cooldown including initial registration', async () => {
    const { service, tx, email } = await harness();
    tx.emailVerificationToken.findFirst.mockResolvedValueOnce({ id: 'recent-token' });
    await service.resendVerification(REQUEST.email);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.emailVerificationToken.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-id',
        createdAt: { gt: new Date(NOW.getTime() - 60_000) },
      },
      select: { id: true },
    });
    expect(tx.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('invalidates older verification links and sends only after a new token is persisted', async () => {
    const { service, tx, email } = await harness();
    await service.resendVerification(REQUEST.email);
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-id', deletedAt: null, accountStatus: 'ACTIVE', emailVerifiedAt: null },
      select: { email: true },
    });
    expect(tx.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(REQUEST.email, expect.any(String));
  });

  it('does not issue verification links for an account that became verified while waiting for its lock', async () => {
    const { service, tx, email } = await harness();
    tx.user.findFirst.mockResolvedValueOnce(null);
    await service.resendVerification(REQUEST.email);
    expect(tx.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('changes the password and invalidates all links and sessions in one transaction', async () => {
    const { service, prisma, tx, passwords, jwt } = await harness();
    await expect(service.resetPassword(RESET)).resolves.toEqual({
      message: 'Password reset successfully. Sign in with your new password.',
    });
    expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: createHash('sha256').update(TOKEN).digest('hex') },
      select: { id: true, userId: true, consumedAt: true, expiresAt: true },
    });
    expect(passwords.hash).toHaveBeenCalledWith(RESET.password);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.passwordResetToken.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'reset-id', consumedAt: null, expiresAt: { gt: NOW } },
      data: { consumedAt: NOW },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { passwordHash: 'new-argon2id-hash' },
    });
    expect(tx.passwordResetToken.updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-id', consumedAt: null },
      data: { consumedAt: NOW },
    });
    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', consumedAt: null },
      data: { consumedAt: NOW },
    });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', revokedAt: null },
      data: { revokedAt: NOW },
    });
    expect(jwt.signAccessToken).not.toHaveBeenCalled();
    expect(tx.authSession.create).not.toHaveBeenCalled();
  });

  it.each(['unknown or verification token', 'expired', 'already used'])(
    'rejects %s before hashing a password',
    async (reason) => {
      const { service, prisma, tx, passwords } = await harness();
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        reason === 'unknown or verification token'
          ? null
          : {
              id: 'reset-id',
              userId: 'user-id',
              consumedAt: reason === 'already used' ? NOW : null,
              expiresAt: reason === 'expired' ? NOW : new Date(NOW.getTime() + 60_000),
            },
      );
      await expect(service.resetPassword(RESET)).rejects.toThrow(INVALID_LINK);
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    },
  );

  it.each(['deleted', 'suspended', 'unverified', 'passwordless'])(
    'rejects an ineligible %s account under the user lock',
    async () => {
      const { service, tx } = await harness();
      tx.user.findFirst.mockResolvedValue(null);
      await expect(service.resetPassword(RESET)).rejects.toThrow(INVALID_LINK);
      expect(tx.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'user-id',
          deletedAt: null,
          accountStatus: 'ACTIVE',
          emailVerifiedAt: { not: null },
          passwordHash: { not: null },
        },
        select: { id: true },
      });
      expect(tx.user.update).not.toHaveBeenCalled();
    },
  );

  it('rejects a concurrent redemption or expiry while hashing before changing credentials', async () => {
    const { service, tx } = await harness();
    tx.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.resetPassword(RESET)).rejects.toThrow(INVALID_LINK);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('propagates a session-revocation failure so the transaction rolls back', async () => {
    const { service, tx } = await harness();
    tx.authSession.updateMany.mockRejectedValueOnce(new Error('database failure'));
    await expect(service.resetPassword(RESET)).rejects.toThrow('database failure');
  });

  it('rejects an old-password login if reset committed while its password was being verified', async () => {
    const { service, prisma, tx } = await harness();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-id',
      passwordHash: 'old-hash',
      email: REQUEST.email,
      role: 'STUDENT',
      emailVerifiedAt: NOW,
      accountStatus: 'ACTIVE',
    });
    tx.user.findFirst.mockResolvedValue(null);
    await expect(
      service.login({ email: REQUEST.email, password: 'old-password123' }),
    ).rejects.toThrow('Email or password is incorrect');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.authSession.create).not.toHaveBeenCalled();
  });

  it('creates a verified session in the same user-locked transaction that consumes the link', async () => {
    const { service, tx } = await harness();
    tx.user.findFirst.mockResolvedValue({
      id: 'user-id',
      email: REQUEST.email,
      role: Role.STUDENT,
      emailVerifiedAt: null,
    });
    await expect(service.verifyEmail({ token: TOKEN })).resolves.toMatchObject({
      accessToken: 'access',
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { emailVerifiedAt: NOW },
    });
    expect(tx.authSession.create).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.emailVerificationToken.updateMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('cannot issue a session from a verification token invalidated by reset while waiting for the lock', async () => {
    const { service, tx } = await harness();
    tx.emailVerificationToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.verifyEmail({ token: TOKEN })).rejects.toThrow(
      'Verification link is invalid or expired',
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.authSession.create).not.toHaveBeenCalled();
  });

  it('creates a session inside the user lock when credentials are still current', async () => {
    const { service, prisma, tx } = await harness();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-id',
      passwordHash: 'current-hash',
      email: REQUEST.email,
      role: 'STUDENT',
      emailVerifiedAt: NOW,
      accountStatus: 'ACTIVE',
    });
    await expect(
      service.login({ email: REQUEST.email, password: 'password123' }),
    ).resolves.toMatchObject({ accessToken: 'access' });
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'user-id',
        passwordHash: 'current-hash',
        deletedAt: null,
        accountStatus: 'ACTIVE',
        emailVerifiedAt: { not: null },
      },
      select: { id: true },
    });
    expect(tx.authSession.create).toHaveBeenCalled();
  });
});

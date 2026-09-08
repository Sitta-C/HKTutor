import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { AuthService } from '@/auth/auth.service';
import { AccountStatus, Role } from '@/generated/prisma/client';

import type { JwtTokenService } from '@/auth/jwt.service';
import type { PasswordService } from '@/auth/password.service';
import type { AuthConfigService } from '@/config/auth.config';
import type { PrismaService } from '@/database/prisma.service';
import type { EmailService } from '@/email/email.service';

describe('AuthService', () => {
  it('stores password and verification-token hashes before sending the plain token', async () => {
    const userFindFirst = jest.fn().mockResolvedValue(null);
    const userCreate = jest.fn().mockResolvedValue({ id: 'user-id' });
    const verificationCreate = jest.fn().mockResolvedValue({ id: 'token-id' });
    const transaction = jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation({
        user: { create: userCreate },
        emailVerificationToken: { create: verificationCreate },
      }),
    );
    const sendVerificationEmail = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      prisma: { user: { findFirst: userFindFirst }, $transaction: transaction },
      passwords: { hash: jest.fn().mockResolvedValue('argon2id-hash') },
      email: { sendVerificationEmail },
    });

    await expect(
      service.register({
        email: 'student@example.com',
        password: 'password123',
        role: 'student',
        consent: true,
        policyVersion: '2026-09-08',
      }),
    ).resolves.toEqual({ message: 'Check your email to verify your account.' });

    const userCreateCalls = userCreate.mock.calls as unknown as Array<
      [{ data: { email: string; passwordHash: string; role: Role } }]
    >;
    expect(userCreateCalls[0]?.[0].data).toMatchObject({
      email: 'student@example.com',
      passwordHash: 'argon2id-hash',
      role: Role.STUDENT,
    });
    const verificationCalls = verificationCreate.mock.calls as unknown as Array<
      [{ data: { tokenHash: string } }]
    >;
    const emailCalls = sendVerificationEmail.mock.calls as unknown as Array<[string, string]>;
    const verificationData = verificationCalls[0]?.[0].data;
    const plainToken = emailCalls[0]?.[1];
    expect(verificationData).toBeDefined();
    expect(plainToken).toBeDefined();
    if (!verificationData || !plainToken) throw new Error('registration did not create a token');
    expect(verificationData.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verificationData.tokenHash).not.toBe(plainToken);
    expect(plainToken.length).toBeGreaterThanOrEqual(32);
  });

  it('rejects login before email verification even when the password is valid', async () => {
    const service = createService({
      prisma: {
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'user-id',
            email: 'student@example.com',
            passwordHash: 'stored-hash',
            emailVerifiedAt: null,
            accountStatus: AccountStatus.ACTIVE,
            role: Role.STUDENT,
          }),
        },
      },
      passwords: { verify: jest.fn().mockResolvedValue(true) },
    });

    await expect(
      service.login({ email: 'student@example.com', password: 'password123' }),
    ).rejects.toThrow(new ForbiddenException('Verify your email before signing in'));
  });

  it('revokes a session when a previously rotated refresh token is reused', async () => {
    const revoke = jest.fn().mockResolvedValue({ id: 'session-id' });
    const service = createService({
      prisma: {
        authSession: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'session-id',
            userId: 'user-id',
            refreshTokenHash: '0'.repeat(64),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: {
              id: 'user-id',
              email: 'student@example.com',
              emailVerifiedAt: new Date(),
              accountStatus: AccountStatus.ACTIVE,
              deletedAt: null,
              role: Role.STUDENT,
            },
          }),
          update: revoke,
        },
      },
      jwtTokens: {
        verifyRefreshToken: jest.fn().mockReturnValue({
          sub: 'user-id',
          sid: 'session-id',
          role: Role.STUDENT,
          type: 'refresh',
        }),
      },
    });

    await expect(service.refresh('reused-refresh-token')).rejects.toThrow(
      new UnauthorizedException('Invalid or expired refresh token'),
    );
    const revokeCalls = revoke.mock.calls as unknown as Array<
      [{ where: { id: string }; data: { revokedAt: Date } }]
    >;
    expect(revokeCalls[0]?.[0].where).toEqual({ id: 'session-id' });
    expect(revokeCalls[0]?.[0].data.revokedAt).toBeInstanceOf(Date);
  });
});

function createService(overrides: {
  prisma?: unknown;
  passwords?: unknown;
  jwtTokens?: unknown;
  email?: unknown;
}): AuthService {
  const config = {
    accessTtlSeconds: 900,
    refreshTtlSeconds: 604_800,
    verificationTtlMinutes: 60,
  } as AuthConfigService;

  return new AuthService(
    (overrides.prisma ?? {}) as PrismaService,
    (overrides.passwords ?? {}) as PasswordService,
    (overrides.jwtTokens ?? {}) as JwtTokenService,
    (overrides.email ?? {}) as EmailService,
    config,
  );
}

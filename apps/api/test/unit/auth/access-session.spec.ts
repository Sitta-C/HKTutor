import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AuthConfigService } from '@config/auth.config';
import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { verifyAccessSession } from '@modules/auth/access-session';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtTokenService } from '@modules/auth/jwt.service';

describe('shared access session verifier', () => {
  const findUnique = jest.fn();
  let tokens: JwtTokenService;
  let prisma: PrismaService;
  let token: string;

  function fixture() {
    return {
      id: 'synthetic-session',
      userId: 'synthetic-user',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 'synthetic-user',
        email: 'synthetic@example.invalid',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        emailVerifiedAt: new Date(),
        consentAcceptedAt: new Date(),
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      },
    };
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        JwtTokenService,
        { provide: AuthConfigService, useValue: new AuthConfigService(new ConfigService()) },
        { provide: PrismaService, useValue: { authSession: { findUnique } } },
      ],
    }).compile();
    tokens = module.get(JwtTokenService);
    prisma = module.get(PrismaService);
    token = tokens.signAccessToken('synthetic-user', 'synthetic-session', Role.ADMIN);
    findUnique.mockResolvedValue(fixture());
  });

  it('uses the current database role rather than the token role and bounds socket lifetime', async () => {
    const session = fixture();
    findUnique.mockResolvedValue(session);
    expect(await verifyAccessSession(token, tokens, prisma, true)).toEqual({
      user: {
        id: 'synthetic-user',
        email: 'synthetic@example.invalid',
        role: Role.STUDENT,
        sessionId: 'synthetic-session',
      },
      expiresAt: session.expiresAt.getTime(),
    });
  });

  it('preserves REST access for admins and users without current chat consent', async () => {
    findUnique.mockResolvedValue({
      ...fixture(),
      user: { ...fixture().user, role: Role.ADMIN, consentAcceptedAt: null, policyVersion: 'old' },
    });
    expect((await verifyAccessSession(token, tokens, prisma)).user.role).toBe(Role.ADMIN);
    await expect(verifyAccessSession(token, tokens, prisma, true)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each([
    ['deletedAt', new Date()],
    ['accountStatus', AccountStatus.SUSPENDED],
    ['emailVerifiedAt', null],
  ])('keeps REST 401 while chat returns 403 for ineligible %s', async (key, value) => {
    findUnique.mockResolvedValue({ ...fixture(), user: { ...fixture().user, [key]: value } });
    await expect(verifyAccessSession(token, tokens, prisma)).rejects.toThrow(UnauthorizedException);
    await expect(verifyAccessSession(token, tokens, prisma, true)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each([
    null,
    { ...fixture(), userId: 'other' },
    { ...fixture(), revokedAt: new Date() },
    { ...fixture(), expiresAt: new Date(0) },
  ])('rejects an invalid session for either transport %#', async (session) => {
    findUnique.mockResolvedValue(session);
    for (const chat of [false, true]) {
      await expect(verifyAccessSession(token, tokens, prisma, chat)).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('rejects invalid JWTs before persistence', async () => {
    await expect(verifyAccessSession('invalid', tokens, prisma)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findUnique).not.toHaveBeenCalled();
  });
});

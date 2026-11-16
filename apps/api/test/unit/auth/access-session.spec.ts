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
  const now = new Date('2026-11-16T05:00:00.000Z');
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
    jest.useFakeTimers().setSystemTime(now);
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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects a session at its exact expiry boundary', async () => {
    findUnique.mockResolvedValue({ ...fixture(), expiresAt: now });
    await expect(verifyAccessSession(token, tokens, prisma)).rejects.toThrow(UnauthorizedException);
  });

  it('caps access at JWT expiry when the database session lasts longer', async () => {
    findUnique.mockResolvedValue({
      ...fixture(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    const payload = tokens.verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect((await verifyAccessSession(token, tokens, prisma)).expiresAt).toBe(
      (payload?.exp ?? 0) * 1000,
    );
  });

  it('allows an eligible tutor into chat and reads the token subject/session', async () => {
    findUnique.mockResolvedValue({ ...fixture(), user: { ...fixture().user, role: Role.TUTOR } });
    expect((await verifyAccessSession(token, tokens, prisma, true)).user.role).toBe(Role.TUTOR);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'synthetic-session' },
      include: { user: true },
    });
  });

  it('does not turn a persistence failure into an authenticated session', async () => {
    const failure = new Error('Synthetic database failure');
    findUnique.mockRejectedValue(failure);
    await expect(verifyAccessSession(token, tokens, prisma)).rejects.toBe(failure);
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
    { consentAcceptedAt: null, policyVersion: CURRENT_PRIVACY_POLICY_VERSION },
    { consentAcceptedAt: new Date(), policyVersion: null },
    { consentAcceptedAt: new Date(), policyVersion: 'obsolete-policy' },
  ])('requires current consent only when REST opts in %#', async (consent) => {
    findUnique.mockResolvedValue({ ...fixture(), user: { ...fixture().user, ...consent } });

    await expect(verifyAccessSession(token, tokens, prisma)).resolves.toBeDefined();
    await expect(verifyAccessSession(token, tokens, prisma, false, true)).rejects.toThrow(
      new ForbiddenException('Accept the current privacy notice to continue.'),
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

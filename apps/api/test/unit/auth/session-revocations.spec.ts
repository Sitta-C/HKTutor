import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AuthConfigService } from '@config/auth.config';
import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { AuthService } from '@modules/auth/auth.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { PasswordService } from '@modules/auth/password.service';
import { SessionRevocations } from '@modules/auth/session-revocations';

describe('committed auth revocations notify socket cleanup', () => {
  const db = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    authSession: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    passwordResetToken: { findUnique: jest.fn(), updateMany: jest.fn() },
    user: { findFirst: jest.fn(), update: jest.fn() },
    emailVerificationToken: { updateMany: jest.fn() },
  };
  const revoke = jest.fn();
  let service: AuthService;
  let tokens: JwtTokenService;
  beforeEach(async () => {
    jest.resetAllMocks();
    const revocations = new SessionRevocations();
    revocations.subscribe(revoke);
    db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtTokenService,
        { provide: SessionRevocations, useValue: revocations },
        { provide: AuthConfigService, useValue: new AuthConfigService(new ConfigService()) },
        { provide: PrismaService, useValue: db },
        {
          provide: PasswordService,
          useValue: { hash: jest.fn().mockResolvedValue('synthetic-hash') },
        },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
    tokens = module.get(JwtTokenService);
  });

  it('notifies the exact session only after logout persistence succeeds', async () => {
    const token = tokens.signRefreshToken('user', 'session', Role.STUDENT);
    db.authSession.updateMany.mockImplementation(() => {
      expect(revoke).not.toHaveBeenCalled();
      return Promise.resolve({ count: 1 });
    });
    await service.logout(token);
    expect(revoke).toHaveBeenCalledWith({ userId: 'user', sessionId: 'session' });
  });

  it('does not announce a logout that failed to persist', async () => {
    db.authSession.updateMany.mockRejectedValue(new Error('Synthetic persistence failure'));
    await expect(
      service.logout(tokens.signRefreshToken('user', 'session', Role.STUDENT)),
    ).rejects.toThrow();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('notifies all user sessions after the password reset transaction commits', async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset',
      userId: 'user',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    db.user.findFirst.mockResolvedValue({ id: 'user' });
    db.authSession.updateMany.mockImplementation(() => {
      expect(revoke).not.toHaveBeenCalled();
      return Promise.resolve({ count: 2 });
    });
    await service.resetPassword({ token: 'synthetic-reset', password: 'synthetic-password' });
    expect(revoke).toHaveBeenCalledWith({ userId: 'user' });
  });

  it('does not announce a reset when its transaction rolls back', async () => {
    db.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset',
      userId: 'user',
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    db.$transaction.mockRejectedValue(new Error('Synthetic transaction failure'));
    await expect(
      service.resetPassword({ token: 'synthetic-reset', password: 'synthetic-password' }),
    ).rejects.toThrow();
    expect(revoke).not.toHaveBeenCalled();
  });

  const reusedRefreshSession = () => ({
    id: 'session',
    userId: 'user',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    refreshTokenHash: '0'.repeat(64),
    user: {
      id: 'user',
      email: 'synthetic@example.invalid',
      role: Role.STUDENT,
      deletedAt: null,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  it('notifies the exact session only after refresh-token reuse revocation persists', async () => {
    db.authSession.findUnique.mockResolvedValue(reusedRefreshSession());
    db.authSession.update.mockImplementation(() => {
      expect(revoke).not.toHaveBeenCalled();
      return Promise.resolve({});
    });
    await expect(
      service.refresh(tokens.signRefreshToken('user', 'session', Role.STUDENT)),
    ).rejects.toThrow(UnauthorizedException);
    expect(db.authSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session' } }),
    );
    expect(revoke).toHaveBeenCalledWith({ userId: 'user', sessionId: 'session' });
  });

  it('does not announce a refresh-token reuse revocation that failed to persist', async () => {
    db.authSession.findUnique.mockResolvedValue(reusedRefreshSession());
    db.authSession.update.mockRejectedValue(new Error('Synthetic persistence failure'));
    await expect(
      service.refresh(tokens.signRefreshToken('user', 'session', Role.STUDENT)),
    ).rejects.toThrow('Synthetic persistence failure');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('unsubscribes closed consumers', () => {
    const events = new SessionRevocations();
    const unsubscribe = events.subscribe(revoke);
    unsubscribe();
    events.revoke({ userId: 'user' });
    expect(revoke).not.toHaveBeenCalled();
  });
});

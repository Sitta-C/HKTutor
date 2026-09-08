import { UnauthorizedException } from '@nestjs/common';

import { JwtAuthGuard } from '@/auth/auth.guard';
import { AccountStatus, Role } from '@/generated/prisma/client';

import type { AuthenticatedRequest } from '@/auth/auth.guard';
import type { JwtTokenService } from '@/auth/jwt.service';
import type { PrismaService } from '@/database/prisma.service';
import type { ExecutionContext } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';

describe('JwtAuthGuard', () => {
  const verifyAccessToken = jest.fn();
  const findUnique = jest.fn();
  const guard = new JwtAuthGuard(
    { verifyAccessToken } as unknown as JwtTokenService,
    { authSession: { findUnique } } as unknown as PrismaService,
  );

  afterEach(() => jest.resetAllMocks());

  it('accepts a signed access token backed by an active session', async () => {
    verifyAccessToken.mockReturnValue({ sub: 'user-id', sid: 'session-id' });
    findUnique.mockResolvedValue({
      id: 'session-id',
      userId: 'user-id',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: 'user-id',
        email: 'student@example.com',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        deletedAt: null,
      },
    });
    const context = createContext('Bearer signed-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest<AuthenticatedRequest>().auth).toEqual({
      id: 'user-id',
      email: 'student@example.com',
      role: Role.STUDENT,
      sessionId: 'session-id',
    });
  });

  it('rejects a missing bearer token before verification', async () => {
    await expect(guard.canActivate(createContext())).rejects.toThrow(
      new UnauthorizedException('Missing authentication token'),
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature without exposing verification details', async () => {
    verifyAccessToken.mockReturnValue(null);

    await expect(guard.canActivate(createContext('Bearer invalid'))).rejects.toThrow(
      'Invalid or expired authentication token',
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a revoked session', async () => {
    verifyAccessToken.mockReturnValue({ sub: 'user-id', sid: 'session-id' });
    findUnique.mockResolvedValue({
      userId: 'user-id',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      user: {},
    });

    await expect(guard.canActivate(createContext('Bearer signed-token'))).rejects.toThrow(
      'Invalid or expired authentication token',
    );
  });
});

function createContext(authorization?: string): ExecutionContext {
  const headers: ExpressRequest['headers'] = {};
  if (authorization) headers.authorization = authorization;
  const request = { headers } as ExpressRequest;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

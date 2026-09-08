import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { RolesGuard } from '@/auth/roles.guard';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedRequest, AuthenticatedUser } from '@/auth/auth.guard';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

describe('RolesGuard', () => {
  const getAllAndOverride = jest.fn();
  const guard = new RolesGuard({ getAllAndOverride } as unknown as Reflector);

  afterEach(() => jest.resetAllMocks());

  it('allows a route that does not declare role restrictions', () => {
    getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('allows an authenticated user with one of the permitted roles', () => {
    getAllAndOverride.mockReturnValue([Role.ADMIN, Role.TUTOR]);

    expect(guard.canActivate(createContext(authenticatedUser(Role.TUTOR)))).toBe(true);
  });

  it('returns 403 when an authenticated user does not have a permitted role', () => {
    getAllAndOverride.mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(createContext(authenticatedUser(Role.STUDENT)))).toThrow(
      new ForbiddenException('You do not have permission to access this resource'),
    );
  });

  it('returns 401 when role authorization runs without an authenticated user', () => {
    getAllAndOverride.mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(createContext())).toThrow(
      new UnauthorizedException('Authentication is required before role authorization'),
    );
  });
});

function authenticatedUser(role: Role): AuthenticatedUser {
  return {
    email: 'user@example.com',
    id: 'user-id',
    role,
    sessionId: 'session-id',
  };
}

function createContext(auth?: AuthenticatedUser): ExecutionContext {
  const request = { auth } as AuthenticatedRequest;

  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

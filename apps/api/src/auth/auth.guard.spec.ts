import { UnauthorizedException } from '@nestjs/common';

import { ClerkAuthGuard, type AuthenticatedRequest } from '@/auth/auth.guard';

import type { ClerkClient } from '@clerk/backend';
import type { ExecutionContext } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';

type AuthenticateRequest = ClerkClient['authenticateRequest'];
type AuthenticationState = Awaited<ReturnType<AuthenticateRequest>>;

describe('ClerkAuthGuard', () => {
  const authenticateRequest = jest.fn<
    ReturnType<AuthenticateRequest>,
    Parameters<AuthenticateRequest>
  >();
  const guard = new ClerkAuthGuard({ authenticateRequest } as unknown as ClerkClient);

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('accepts a valid Clerk token', async () => {
    authenticateRequest.mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_test' }),
    } as AuthenticationState);

    const context = createContext('Bearer valid-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    const request = authenticateRequest.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect(request?.headers.get('authorization')).toBe('Bearer valid-token');
    expect(context.switchToHttp().getRequest<AuthenticatedRequest>().auth).toEqual({
      userId: 'user_test',
    });
  });

  it('rejects a request without a token', async () => {
    await expectUnauthorized(guard.canActivate(createContext()), 'Missing authentication token');
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it.each(['Bearer', 'Basic opaque-token'])(
    'rejects a malformed authorization header: %s',
    async (header) => {
      await expectUnauthorized(
        guard.canActivate(createContext(header)),
        'Missing authentication token',
      );
      expect(authenticateRequest).not.toHaveBeenCalled();
    },
  );

  it('rejects a token Clerk reports as invalid', async () => {
    authenticateRequest.mockResolvedValue({ isAuthenticated: false } as AuthenticationState);

    await expectUnauthorized(
      guard.canActivate(createContext('Bearer invalid-token')),
      'Invalid or expired authentication token',
    );
  });

  it('rejects an expired token without exposing Clerk verification details', async () => {
    authenticateRequest.mockRejectedValue(
      new Error('JWT expired at 2026-09-08T00:00:00Z; issuer=secret-clerk-instance'),
    );

    try {
      await guard.canActivate(createContext('Bearer expired-token'));
      throw new Error('Expected guard to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      const response = (error as UnauthorizedException).getResponse();
      expect(response).toMatchObject({
        message: 'Invalid or expired authentication token',
        statusCode: 401,
      });
      expect(JSON.stringify(response)).not.toContain('secret-clerk-instance');
    }
  });
});

function createContext(authorization?: string): ExecutionContext {
  const headers: ExpressRequest['headers'] = {};
  if (authorization) headers.authorization = authorization;

  const request = {
    get: jest.fn().mockReturnValue('localhost:3001'),
    headers,
    method: 'GET',
    originalUrl: '/api/protected',
    protocol: 'http',
    url: '/api/protected',
  } as unknown as ExpressRequest;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function expectUnauthorized(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
    throw new Error('Expected guard to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      message,
      statusCode: 401,
    });
  }
}

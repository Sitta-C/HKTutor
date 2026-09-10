import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loginAccount, logoutSession, registerAccount } from '@/lib/api/auth';
import {
  authenticatedFetch,
  clearAccessToken,
  onSessionExpired,
  setAccessToken,
} from '@/lib/api/client';

const user = { id: 'user-id', email: 'student@example.com', role: 'STUDENT' as const };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('authentication API client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearAccessToken();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearAccessToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    'invalid access token',
    'expired access token',
    'wrong-type access token',
    'revoked session',
    'missing session',
  ])('expires the frontend session after %s produces a 401', async () => {
    setAccessToken('stale-access-token');
    const expired = vi.fn();
    const unsubscribe = onSessionExpired(expired);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid or expired authentication token' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid or expired refresh token' }, 401));

    await expect(authenticatedFetch('/profiles/me')).rejects.toMatchObject({ status: 401 });

    const protectedRequest = fetchMock.mock.calls[0];
    const refreshRequest = fetchMock.mock.calls[1];
    expect(protectedRequest?.[0]).toBe('/api/v1/profiles/me');
    expect(protectedRequest?.[1]).toMatchObject({ credentials: 'include' });
    expect(new Headers((protectedRequest?.[1] as RequestInit).headers).get('Authorization')).toBe(
      'Bearer stale-access-token',
    );
    expect(refreshRequest?.[0]).toBe('/api/v1/auth/refresh');
    expect(refreshRequest?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
    expect(expired).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('uses the rotated access token after a successful refresh', async () => {
    setAccessToken('expired-access-token');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid or expired authentication token' }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'rotated-access-token', expiresIn: 900, user }))
      .mockResolvedValueOnce(jsonResponse({ profileComplete: true }));

    await expect(authenticatedFetch('/profiles/me')).resolves.toEqual({ profileComplete: true });

    const retriedRequest = fetchMock.mock.calls[2];
    expect(retriedRequest?.[0]).toBe('/api/v1/profiles/me');
    expect(new Headers((retriedRequest?.[1] as RequestInit).headers).get('Authorization')).toBe(
      'Bearer rotated-access-token',
    );
  });

  it.each([
    ['unverified account', 403, 'Verify your email before signing in'],
    ['suspended account', 403, 'This account is not active'],
    ['deleted account', 401, 'Email or password is incorrect'],
  ])('does not retain an access token when login rejects a %s', async (_case, status, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message }, status));

    await expect(loginAccount('student@example.com', 'password123')).rejects.toMatchObject({
      message,
      status,
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ profileComplete: true }));
    await authenticatedFetch('/profiles/me');
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(request.headers).has('Authorization')).toBe(false);
  });

  it('surfaces a 400 admin-registration rejection without creating an authenticated request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'role must be one of student, tutor' }, 400));

    await expect(
      registerAccount({
        email: 'admin@example.com',
        password: 'password1234',
        role: 'admin' as never,
        consent: true,
        policyVersion: '2026-09-09',
      }),
    ).rejects.toMatchObject({ status: 400 });

    fetchMock.mockResolvedValueOnce(jsonResponse({ profileComplete: true }));
    await authenticatedFetch('/profiles/me');
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(request.headers).has('Authorization')).toBe(false);
  });

  it('makes repeated logout safe and clears the access token each time', async () => {
    setAccessToken('access-token');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(logoutSession()).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(logoutSession()).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(jsonResponse({ profileComplete: true }));
    await authenticatedFetch('/profiles/me');
    const request = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(new Headers(request.headers).has('Authorization')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears the access token when logout fails', async () => {
    setAccessToken('access-token');
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'session unavailable' }, 401));

    await expect(logoutSession()).rejects.toMatchObject({ status: 401 });

    fetchMock.mockResolvedValueOnce(jsonResponse({ profileComplete: true }));
    await authenticatedFetch('/profiles/me');
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(request.headers).has('Authorization')).toBe(false);
  });
});

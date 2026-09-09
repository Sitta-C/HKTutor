'use client';

import { ApiError } from '@/lib/api/error';

import type { AuthResponse } from '@/lib/api/types';

const API_BASE_URL = '/api/v1';
const REFRESH_LOCK_NAME = 'hktutor-auth-refresh';

let accessToken: string | null = null;
let refreshRequest: Promise<AuthResponse> | null = null;
const sessionExpiredListeners = new Set<() => void>();

interface ApiRequestOptions {
  authenticated?: boolean;
  retryOnUnauthorized?: boolean;
}

interface ApiErrorBody {
  error?: string;
  message?: string | string[];
  statusCode?: number;
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T;

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  }

  let message = `Request failed with status ${response.status}`;
  let details: unknown;

  try {
    const body = (await response.json()) as ApiErrorBody;
    details = body;
    if (Array.isArray(body.message)) message = body.message.join(', ');
    else if (body.message) message = body.message;
    else if (body.error) message = body.error;
  } catch {
    // Keep the status-based fallback for non-JSON responses.
  }

  throw new ApiError(message, response.status, details);
}

function expireSession(): void {
  accessToken = null;
  for (const listener of sessionExpiredListeners) listener();
}

async function send<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('API paths must start with a single slash');
  }

  const headers = new Headers(init.headers);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (authenticated && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: init.cache ?? 'no-store',
    credentials: 'include',
    headers,
  });

  return readResponse<T>(response);
}

async function runRefresh(): Promise<AuthResponse> {
  const result = await send<AuthResponse>('/auth/refresh', { method: 'POST' }, false);
  accessToken = result.accessToken;
  return result;
}

async function runRefreshWithCrossTabLock(): Promise<AuthResponse> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(REFRESH_LOCK_NAME, runRefresh);
  }
  return runRefresh();
}

export async function refreshAccessToken(): Promise<AuthResponse> {
  refreshRequest ??= runRefreshWithCrossTabLock()
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) expireSession();
      throw error;
    })
    .finally(() => {
      refreshRequest = null;
    });

  return refreshRequest;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const authenticated = options.authenticated ?? false;

  try {
    return await send<T>(path, init, authenticated);
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 401 ||
      !authenticated ||
      options.retryOnUnauthorized === false
    ) {
      throw error;
    }
  }

  await refreshAccessToken();

  try {
    return await send<T>(path, init, true);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) expireSession();
    throw error;
  }
}

export function authenticatedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, init, { authenticated: true });
}

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

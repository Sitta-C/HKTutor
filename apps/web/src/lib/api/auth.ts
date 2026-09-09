'use client';

import { apiFetch, clearAccessToken, refreshAccessToken, setAccessToken } from '@/lib/api/client';

import type { AuthResponse, AuthUser, RegisterPayload } from '@/lib/api/types';

export async function registerAccount(payload: RegisterPayload): Promise<{ message: string }> {
  return apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
}

export async function loginAccount(email: string, password: string): Promise<AuthUser> {
  const result = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(result.accessToken);
  return result.user;
}

export async function verifyEmail(token: string): Promise<AuthUser> {
  const result = await apiFetch<AuthResponse>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  setAccessToken(result.accessToken);
  return result.user;
}

export async function resendVerification(email: string): Promise<{ message: string }> {
  return apiFetch('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function refreshSession(): Promise<AuthResponse> {
  return refreshAccessToken();
}

export async function logoutSession(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    clearAccessToken();
  }
}

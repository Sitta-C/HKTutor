'use client';

import { apiFetch, clearAccessToken, refreshAccessToken, setAccessToken } from '@/lib/api/client';

import type {
  AuthResponse,
  AuthUser,
  EmailFlow,
  EmailFlowPurpose,
  EmailRequestResponse,
  RegisterPayload,
  ResetPasswordPayload,
} from '@/lib/api/types';

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

export async function resendVerification(flowId: string): Promise<EmailRequestResponse> {
  return apiFetch('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ flowId }),
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

export function requestPasswordReset(email: string): Promise<EmailRequestResponse> {
  return apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function resetAccountPassword(payload: ResetPasswordPayload): Promise<void> {
  await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify(payload) });
  clearAccessToken();
}

export function resendPasswordReset(flowId: string): Promise<EmailRequestResponse> {
  return apiFetch('/auth/resend-password-reset', {
    method: 'POST',
    body: JSON.stringify({ flowId }),
  });
}

export function getEmailFlow(purpose: EmailFlowPurpose, signal?: AbortSignal): Promise<EmailFlow> {
  const query = new URLSearchParams({ purpose });
  return apiFetch(`/auth/email-flow?${query}`, { signal: signal ?? null });
}

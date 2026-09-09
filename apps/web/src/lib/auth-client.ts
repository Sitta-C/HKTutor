export type UserRole = 'STUDENT' | 'TUTOR' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

interface RegisterPayload {
  email: string;
  password: string;
  role: 'student' | 'tutor';
  consent: boolean;
  policyVersion: string;
}

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001').replace(
  /\/+$/,
  '',
);
const apiBaseUrl = `${backendUrl}/api/v1`;

let accessToken: string | null = null;
let refreshRequest: Promise<AuthResponse> | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) message = body.message.join(', ');
    else if (body.message) message = body.message;
  } catch {
    // Keep the status-based fallback for non-JSON responses.
  }
  throw new ApiError(message, response.status);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { authenticated?: boolean; retry?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.authenticated && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (response.status === 401 && options.authenticated && options.retry !== false) {
    await refreshSession();
    return request<T>(path, init, { authenticated: true, retry: false });
  }

  return readResponse<T>(response);
}

export async function registerAccount(payload: RegisterPayload): Promise<{ message: string }> {
  return request('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
}

export async function loginAccount(email: string, password: string): Promise<AuthUser> {
  const result = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  accessToken = result.accessToken;
  return result.user;
}

export async function verifyEmail(token: string): Promise<AuthUser> {
  const result = await request<AuthResponse>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  accessToken = result.accessToken;
  return result.user;
}

export async function resendVerification(email: string): Promise<{ message: string }> {
  return request('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function refreshSession(): Promise<AuthResponse> {
  refreshRequest ??= request<AuthResponse>('/auth/refresh', { method: 'POST' }, { retry: false })
    .then((result) => {
      accessToken = result.accessToken;
      return result;
    })
    .finally(() => {
      refreshRequest = null;
    });
  return refreshRequest;
}

export async function logoutSession(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' }, { retry: false });
  } finally {
    accessToken = null;
  }
}

export function authenticatedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, { authenticated: true });
}

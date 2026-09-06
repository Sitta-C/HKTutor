// lib/api-client.ts
//
// Generic helper for calling your NestJS backend with a Clerk-issued token.
// Pass in Clerk's `getToken` (from useAuth()) so this stays framework-agnostic
// and easy to mock in tests.

export type GetToken = () => Promise<string | null>;

export class AuthTokenError extends Error {
  constructor(message = 'No Clerk session token available') {
    super(message);
    this.name = 'AuthTokenError';
  }
}

export async function fetchWithAuth(
  getToken: GetToken,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken();

  if (!token) {
    throw new AuthTokenError();
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}

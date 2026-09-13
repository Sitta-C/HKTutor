export const DEFAULT_AUTH_RETURN_TO = '/dashboard';

export function sanitizeReturnTo(
  value: string | null | undefined,
  fallback = DEFAULT_AUTH_RETURN_TO,
): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }

  try {
    const parsed = new URL(value, 'https://hktutor.local');
    if (parsed.origin !== 'https://hktutor.local') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function withReturnTo(path: string, returnTo: string): string {
  const params = new URLSearchParams({ returnTo: sanitizeReturnTo(returnTo) });
  return `${path}?${params.toString()}`;
}

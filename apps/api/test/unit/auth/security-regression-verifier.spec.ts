import { resolve } from 'node:path';

const { disposableSecurityDatabaseUrl, isolatedSecurityEnvironment, refreshCookieFrom } =
  jest.requireActual<{
    disposableSecurityDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
    isolatedSecurityEnvironment: (databaseUrl: string) => Record<string, string>;
    refreshCookieFrom: (
      setCookie: readonly string[] | undefined,
    ) => { value: string; attributes: Set<string> } | null;
  }>(resolve(__dirname, '../../..', 'scripts/verify-sprint3-security.ts'));

describe('Sprint 3 security regression verifier (S3-T38)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55432/hktutor_s3_t38_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('accepts only the explicit, dedicated loopback database', () => {
    expect(() => disposableSecurityDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() =>
      disposableSecurityDatabaseUrl({
        ...approved,
        DATABASE_URL: 'postgresql://tester@db.example.test/hktutor_s3_t38_test',
      }),
    ).toThrow();
    expect(() =>
      disposableSecurityDatabaseUrl({
        ...approved,
        DATABASE_URL: 'postgresql://tester@127.0.0.1:55432/hktutor_s3_t37_test',
      }),
    ).toThrow();
    expect(disposableSecurityDatabaseUrl({ ...approved, DATABASE_URL: safe })).toBe(safe);
  });

  it('runs with no payment provider and only synthetic secrets', () => {
    const env = isolatedSecurityEnvironment(safe);

    expect(env['OMISE_SECRET_KEY']).toBe('');
    expect(env['OMISE_WEBHOOK_SECRET']).toBe('');
    expect(env['RESEND_API_KEY']).toContain('test_only');
    expect(env['COOKIE_SECURE']).toBe('false');
    expect(env['JWT_REFRESH_SECRET']).not.toBe(env['JWT_ACCESS_SECRET']);
  });

  it('reads the refresh cookie value and attributes from any Set-Cookie position', () => {
    const parsed = refreshCookieFrom([
      'other=1; Path=/',
      'hktutor_refresh=a.b%2Bc; Max-Age=60; Path=/; HttpOnly; SameSite=Lax',
    ]);

    expect(parsed?.value).toBe('a.b+c');
    expect([...(parsed?.attributes ?? [])]).toEqual([
      'max-age=60',
      'path=/',
      'httponly',
      'samesite=lax',
    ]);
    expect(refreshCookieFrom(['other=1'])).toBeNull();
    expect(refreshCookieFrom(undefined)).toBeNull();
  });
});

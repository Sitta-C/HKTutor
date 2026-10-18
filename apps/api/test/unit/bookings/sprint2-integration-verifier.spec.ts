import { resolve } from 'node:path';

const { disposableIntegrationDatabaseUrl, isolatedEnvironment } = jest.requireActual<{
  disposableIntegrationDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
  isolatedEnvironment: (databaseUrl: string) => Record<string, string>;
}>(resolve(__dirname, '../../..', 'scripts/verify-sprint2-integration.ts'));

describe('Sprint 2 integration verifier safety (S2-T38)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55441/hktutor_integration_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit opt-in and target', () => {
    expect(() => disposableIntegrationDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableIntegrationDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'postgresql://tester@db.supabase.co/hktutor_integration_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?sslmode=require',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableIntegrationDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it('accepts a loopback hktutor_*_test database', () => {
    expect(disposableIntegrationDatabaseUrl({ ...approved, DATABASE_URL: safe })).toBe(safe);
  });

  it('pins every external credential to a test-only value so a local .env cannot leak in', () => {
    const first = isolatedEnvironment(safe);
    const second = isolatedEnvironment(safe);

    expect(first['DATABASE_URL']).toBe(safe);
    expect(first['NODE_ENV']).toBe('test');
    expect(first['SUPABASE_URL']).toBe('https://storage.example.test');
    expect(first['SUPABASE_SECRET_KEY']).toMatch(/^sb_secret_.*test_only$/);
    expect(first['RESEND_API_KEY']).toMatch(/test_only$/);
    expect(first['SUPABASE_AVATAR_BUCKET']).not.toBe(first['SUPABASE_DOCUMENT_BUCKET']);
    // JWT secrets are random per run, so tokens from one run never validate in another.
    expect(first['JWT_ACCESS_SECRET']).not.toBe(second['JWT_ACCESS_SECRET']);
    expect(first['JWT_ACCESS_SECRET']).not.toBe(first['JWT_REFRESH_SECRET']);
  });
});

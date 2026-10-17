import { resolve } from 'node:path';

const { disposableAccessDatabaseUrl } = jest.requireActual<{
  disposableAccessDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-notification-access.ts'));

describe('notification access verifier target safety (S2-T31)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55439/hktutor_notification_access_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableAccessDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableAccessDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_access_test',
    'postgresql://tester@database.example.test/hktutor_access_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableAccessDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55439/hktutor_notification_access_test`;
      expect(disposableAccessDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(value);
    },
  );
});

import { resolve } from 'node:path';

const { disposableEventDatabaseUrl } = jest.requireActual<{
  disposableEventDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-notification-events.ts'));

describe('notification event verifier target safety', () => {
  const safe = 'postgresql://tester@127.0.0.1:55438/hktutor_notification_events_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableEventDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableEventDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_events_test',
    'postgresql://tester@database.example.test/hktutor_events_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableEventDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55438/hktutor_notification_events_test`;
      expect(disposableEventDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(value);
    },
  );
});

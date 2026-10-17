import { resolve } from 'node:path';

const { disposableMeetingDatabaseUrl } = jest.requireActual<{
  disposableMeetingDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-meeting-link-access.ts'));

describe('meeting link verifier target safety (S2-T34)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55441/hktutor_meeting_link_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableMeetingDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableMeetingDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_meeting_test',
    'postgresql://tester@database.example.test/hktutor_meeting_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableMeetingDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55441/hktutor_meeting_link_test`;
      expect(disposableMeetingDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(value);
    },
  );
});

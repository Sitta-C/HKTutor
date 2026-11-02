import { resolve } from 'node:path';

const { disposableReminderDatabaseUrl } = jest.requireActual<{
  disposableReminderDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-reminder-job.ts'));

describe('reminder job verifier target safety', () => {
  const safe = 'postgresql://tester@127.0.0.1:55442/hktutor_reminder_job_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableReminderDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableReminderDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_reminder_job_test',
    'postgresql://tester@database.example.test/hktutor_reminder_job_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableReminderDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55442/hktutor_reminder_job_test`;
      expect(disposableReminderDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(value);
    },
  );
});

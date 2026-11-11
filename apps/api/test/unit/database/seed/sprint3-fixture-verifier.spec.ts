import { resolve } from 'node:path';

const { disposableSprint3FixtureDatabaseUrl } = jest.requireActual<{
  disposableSprint3FixtureDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../../..', 'scripts/verify-sprint3-fixtures.ts'));

const url = 'postgresql://postgres:disposable-local-only@127.0.0.1:55464/hktutor_db04_test';

describe('Sprint 3 disposable fixture verifier target', () => {
  it('accepts an explicitly opted-in local test database', () => {
    expect(
      disposableSprint3FixtureDatabaseUrl({
        DATABASE_URL: url,
        HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1',
      }),
    ).toBe(url);
  });

  it.each([
    {},
    { DATABASE_URL: url },
    { DATABASE_URL: url, HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '0' },
    { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' },
    ...[
      'postgresql://postgres@database.example/hktutor_db04_test',
      'postgresql://postgres@localhost/hktutor_demo',
      'postgresql://postgres@localhost/hktutor_db04_test?host=database.example',
      'postgresql://postgres@localhost/hktutor_db04_test#fragment',
      'https://localhost/hktutor_db04_test',
    ].map((DATABASE_URL) => ({ DATABASE_URL, HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' })),
  ])('refuses missing consent, remote, non-test or redirected targets %#', (env) => {
    expect(() => disposableSprint3FixtureDatabaseUrl(env)).toThrow();
  });
});

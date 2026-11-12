import { resolve } from 'node:path';

const { disposableSprint3ConcurrencyDatabaseUrl } = jest.requireActual<{
  disposableSprint3ConcurrencyDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-sprint3-concurrency.ts'));

describe('DB05 disposable verifier target', () => {
  const target = 'postgresql://tester@127.0.0.1:55465/hktutor_s3_db05_test';
  it('accepts only an explicitly opted-in local test database', () => {
    expect(
      disposableSprint3ConcurrencyDatabaseUrl({
        DATABASE_URL: target,
        HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1',
      }),
    ).toBe(target);
  });
  it.each([
    {},
    { DATABASE_URL: target },
    ...[
      'invalid',
      'https://localhost/hktutor_db05_test',
      'postgresql://tester@shared.example/hktutor_db05_test',
      'postgresql://tester@localhost/hktutor_demo',
      'postgresql://tester@localhost/hktutor_other_test',
      target + '?host=shared.example',
      target + '#redirect',
    ].map((DATABASE_URL) => ({ DATABASE_URL, HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' })),
  ])('refuses unsafe target %#', (env) => {
    expect(() => disposableSprint3ConcurrencyDatabaseUrl(env)).toThrow();
  });
});

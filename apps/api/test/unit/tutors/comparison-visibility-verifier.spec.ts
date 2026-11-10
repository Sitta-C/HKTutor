import { resolve } from 'node:path';

const { disposableComparisonVisibilityDatabaseUrl } = jest.requireActual<{
  disposableComparisonVisibilityDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-comparison-visibility.ts'));

describe('comparison visibility verifier target safety (S3-T32)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55443/hktutor_comparison_visibility_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableComparisonVisibilityDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableComparisonVisibilityDatabaseUrl(approved)).toThrow();
    expect(() =>
      disposableComparisonVisibilityDatabaseUrl({
        DATABASE_URL: safe,
        HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: 'true',
      }),
    ).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_comparison_visibility_test',
    'postgresql://tester@database.example.test/hktutor_comparison_visibility_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() =>
      disposableComparisonVisibilityDatabaseUrl({ ...approved, DATABASE_URL: value }),
    ).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55443/hktutor_comparison_visibility_test`;
      expect(disposableComparisonVisibilityDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(
        value,
      );
    },
  );
});

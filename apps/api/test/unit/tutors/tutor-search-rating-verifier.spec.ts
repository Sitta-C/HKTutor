import { resolve } from 'node:path';

const { disposableSearchRatingDatabaseUrl } = jest.requireActual<{
  disposableSearchRatingDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-tutor-search-ratings.ts'));

describe('tutor search rating verifier target safety (S3-T19)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55443/hktutor_search_ratings_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableSearchRatingDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableSearchRatingDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_search_ratings_test',
    'postgresql://tester@database.example.test/hktutor_search_ratings_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableSearchRatingDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55443/hktutor_search_ratings_test`;
      expect(disposableSearchRatingDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(value);
    },
  );
});

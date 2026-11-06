import { resolve } from 'node:path';

const { disposableReviewRatingDatabaseUrl } = jest.requireActual<{
  disposableReviewRatingDatabaseUrl: (environment: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-review-ratings.ts'));

describe('review rating verifier target safety', () => {
  const target = 'postgresql://tester@127.0.0.1:55442/hktutor_review_rating_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit disposable target and opt-in', () => {
    expect(() => disposableReviewRatingDatabaseUrl({ DATABASE_URL: target })).toThrow();
    expect(() => disposableReviewRatingDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_review_rating_test',
    'postgresql://tester@shared.example.test/hktutor_review_rating_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    target + '?host=shared.example.test',
    target + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableReviewRatingDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it('accepts the explicit loopback test database', () => {
    expect(disposableReviewRatingDatabaseUrl({ ...approved, DATABASE_URL: target })).toBe(target);
  });
});

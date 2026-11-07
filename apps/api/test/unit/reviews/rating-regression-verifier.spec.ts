import { resolve } from 'node:path';

const { disposableRatingRegressionDatabaseUrl, unicodeFeedback } = jest.requireActual<{
  disposableRatingRegressionDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
  unicodeFeedback: () => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-rating-regression.ts'));

describe('rating regression verifier target safety (S3-T20)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55443/hktutor_rating_regression_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableRatingRegressionDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableRatingRegressionDatabaseUrl(approved)).toThrow();
    expect(() =>
      disposableRatingRegressionDatabaseUrl({
        DATABASE_URL: safe,
        HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: 'true',
      }),
    ).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_rating_regression_test',
    'postgresql://tester@database.example.test/hktutor_rating_regression_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() =>
      disposableRatingRegressionDatabaseUrl({ ...approved, DATABASE_URL: value }),
    ).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55443/hktutor_rating_regression_test`;
      expect(disposableRatingRegressionDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(
        value,
      );
    },
  );
});

describe('rating regression Unicode feedback fixture (S3-T20)', () => {
  const feedback = unicodeFeedback();

  it('is exactly the 1000 code point maximum, more UTF-16 units, with no edge whitespace', () => {
    expect(Array.from(feedback)).toHaveLength(1000);
    expect(feedback.length).toBeGreaterThan(1000);
    expect(feedback.trim()).toBe(feedback);
  });

  it('includes Thai marks, an emoji ZWJ sequence, combining accents and markup-looking text', () => {
    expect(feedback).toContain('ที่');
    expect(feedback).toContain('👩🏽‍🏫');
    expect(feedback).toContain('é');
    expect(feedback).toContain('<b>&amp;</b>');
  });
});

import { resolve } from 'node:path';

const { reconciliationDatabaseUrl } = jest.requireActual<{
  reconciliationDatabaseUrl: (environment: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/reconcile-review-ratings.ts'));

describe('review rating reconciliation command', () => {
  const target = 'postgresql://tester@127.0.0.1:55442/hktutor_review_rating_test';
  const approved = { HKTUTOR_APPLY_REVIEW_RATING_RECONCILIATION: '1' };

  it('requires an explicit target and write opt-in, without a .env fallback', () => {
    expect(() => reconciliationDatabaseUrl({ DATABASE_URL: target })).toThrow();
    expect(() => reconciliationDatabaseUrl(approved)).toThrow();
  });

  it.each(['invalid', 'https://localhost/database', 'postgresql://localhost/'])(
    'rejects an invalid PostgreSQL target %s',
    (value) => {
      expect(() => reconciliationDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
    },
  );

  it('accepts the explicitly approved target', () => {
    expect(reconciliationDatabaseUrl({ ...approved, DATABASE_URL: target })).toBe(target);
  });
});

import { resolve } from 'node:path';

const { disposableSprint3FinalDatabaseUrl, assertMigrationHistory } = jest.requireActual<{
  disposableSprint3FinalDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
  assertMigrationHistory: (
    committed: { name: string; checksum: string }[],
    applied: {
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }[],
  ) => void;
}>(resolve(__dirname, '../../..', 'scripts/verify-sprint3-final.ts'));

describe('DB06 disposable target', () => {
  const target = 'postgresql://tester@127.0.0.1:55468/hktutor_s3_db06_test';
  it.each(['127.0.0.1', 'localhost', '[::1]'])('accepts opted-in loopback %s', (host) => {
    const DATABASE_URL = target.replace('127.0.0.1', host);
    expect(
      disposableSprint3FinalDatabaseUrl({ DATABASE_URL, HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' }),
    ).toBe(DATABASE_URL);
  });
  it.each([
    {},
    { DATABASE_URL: target },
    ...[
      'invalid',
      target.replace('postgresql:', 'https:'),
      target.replace('127.0.0.1', 'shared.example'),
      target.replace('hktutor_s3_db06_test', 'hktutor_demo'),
      target.replace('hktutor_s3_db06_test', 'hktutor_other_test'),
      target + '?host=shared.example',
      target + '#redirect',
    ].map((DATABASE_URL) => ({ DATABASE_URL, HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' })),
  ])('rejects unsafe or implicit target %#', (env) => {
    expect(() => disposableSprint3FinalDatabaseUrl(env)).toThrow();
  });
});

describe('DB06 committed migration history', () => {
  const committed = [
    { name: '001', checksum: 'first-file-hash' },
    { name: '002', checksum: 'second-file-hash' },
  ];
  const applied = committed.map(({ name, checksum }) => ({
    migration_name: name,
    checksum,
    finished_at: new Date('2030-01-01T00:00:00.000Z'),
    rolled_back_at: null,
  }));
  it('accepts matching completed migrations regardless of row order', () => {
    expect(() => assertMigrationHistory(committed, [...applied].reverse())).not.toThrow();
  });
  it.each(
    [
      applied.slice(0, 1),
      [...applied, { ...applied[0], migration_name: 'uncommitted' }],
      [...applied, applied[0]],
      applied.map((row) => ({ ...row, checksum: 'changed' })),
      applied.map((row) => ({ ...row, finished_at: null })),
      applied.map((row) => ({ ...row, rolled_back_at: new Date() })),
    ].map((rows) => ({ rows })),
  )('rejects missing, extra, duplicate, altered or incomplete history %#', ({ rows }) => {
    expect(() => assertMigrationHistory(committed, rows)).toThrow();
  });
});

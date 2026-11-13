import { resolve } from 'node:path';

const { demoRehearsalEnvironment, disposableDemoDatabaseUrl } = jest.requireActual<{
  demoRehearsalEnvironment: (databaseUrl: string) => Record<string, string>;
  disposableDemoDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-sprint3-demo.ts'));

describe('Sprint 3 demo rehearsal (S3-T40)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55432/hktutor_s3_t40_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('accepts only the explicit, dedicated loopback database', () => {
    expect(() => disposableDemoDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() =>
      disposableDemoDatabaseUrl({
        ...approved,
        DATABASE_URL: 'postgresql://tester@127.0.0.1:55432/hktutor_demo',
      }),
    ).toThrow();
    expect(() =>
      disposableDemoDatabaseUrl({
        ...approved,
        DATABASE_URL: 'postgresql://tester@db.supabase.co/hktutor_s3_t40_test',
      }),
    ).toThrow();
    expect(disposableDemoDatabaseUrl({ ...approved, DATABASE_URL: safe })).toBe(safe);
  });

  it('generates fresh seed passwords and synthetic secrets with no payment provider', () => {
    const first = demoRehearsalEnvironment(safe);
    const second = demoRehearsalEnvironment(safe);

    expect(first['SEED_STUDENT_PASSWORD']).not.toBe(second['SEED_STUDENT_PASSWORD']);
    expect((first['SEED_ADMIN_PASSWORD'] ?? '').length).toBeGreaterThanOrEqual(10);
    expect(first['SEED_ADMIN_EMAIL']).toMatch(/@s3-t40\.hktutor\.invalid$/);
    expect(first['OMISE_SECRET_KEY']).toBe('');
    expect(first['OMISE_WEBHOOK_SECRET']).toBe('');
    expect(first['RESEND_API_KEY']).toContain('test_only');
  });
});

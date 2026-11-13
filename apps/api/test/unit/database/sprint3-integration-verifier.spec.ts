import { resolve } from 'node:path';

const { disposableSprint3IntegrationDatabaseUrl, isolatedSprint3Environment, privateFieldsIn } =
  jest.requireActual<{
    disposableSprint3IntegrationDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
    isolatedSprint3Environment: (
      databaseUrl: string,
      webhookSecret: string,
    ) => Record<string, string>;
    privateFieldsIn: (value: unknown) => string[];
  }>(resolve(__dirname, '../../..', 'scripts/verify-sprint3-integration.ts'));

describe('Sprint 3 journey verifier safety (S3-T37)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55432/hktutor_s3_t37_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires the explicit opt-in and URL without reading a fallback .env', () => {
    expect(() => disposableSprint3IntegrationDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableSprint3IntegrationDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'postgresql://tester@db.supabase.co/hktutor_s3_t37_test',
    'postgresql://tester@localhost/hktutor_integration_test',
    'postgresql://tester@localhost/hktutor',
    `${safe}?sslmode=disable`,
    `${safe}#shared`,
  ])('refuses the unsafe or shared target %s', (value) => {
    expect(() =>
      disposableSprint3IntegrationDatabaseUrl({ ...approved, DATABASE_URL: value }),
    ).toThrow();
  });

  it('accepts only the dedicated loopback database', () => {
    expect(disposableSprint3IntegrationDatabaseUrl({ ...approved, DATABASE_URL: safe })).toBe(safe);
  });

  it('pins every provider credential to synthetic test-mode values', () => {
    const env = isolatedSprint3Environment(safe, 'c2VjcmV0'.repeat(8));

    expect(env).toMatchObject({
      DATABASE_URL: safe,
      NODE_ENV: 'test',
      PAYMENT_PROVIDER: 'omise',
      SUPABASE_URL: 'https://storage.example.test',
    });
    expect(env['OMISE_SECRET_KEY']).toMatch(/^skey_test_/);
    expect(env['RESEND_API_KEY']).toContain('test_only');
    expect(env['JWT_ACCESS_SECRET']).not.toBe(
      isolatedSprint3Environment(safe, 'x')['JWT_ACCESS_SECRET'],
    );
  });

  it('finds private fields at any depth of a discovery payload', () => {
    expect(
      privateFieldsIn({
        items: [
          { tutorId: 't', displayName: 'Kru', profile: { email: 'x', nested: [{ phone: '0' }] } },
        ],
      }),
    ).toEqual(['email', 'phone']);
    expect(privateFieldsIn({ items: [{ tutorId: 't', pricePerHour: 450 }] })).toEqual([]);
  });
});

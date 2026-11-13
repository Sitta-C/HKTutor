import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { disposableDatabaseUrl } from '@config/disposable-database-url';

const {
  disposableSprint3FinalDatabaseUrl,
  assertMigrationHistory,
  sprint3FinalEnvironment,
  sprint3FinalDiagnostic,
} = jest.requireActual<{
  disposableSprint3FinalDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
  sprint3FinalEnvironment: (env: NodeJS.ProcessEnv, databaseUrl: string) => NodeJS.ProcessEnv;
  sprint3FinalDiagnostic: (error: unknown, checkpoint: string) => string;
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
  it('preserves generic encoded-name support without weakening exact-name targets', () => {
    const env = {
      DATABASE_URL: target.replace('db06', '%64b06'),
      HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1',
    };
    expect(disposableDatabaseUrl(env)).toBe(env.DATABASE_URL);
    expect(() => disposableSprint3FinalDatabaseUrl(env)).toThrow();
  });
});

describe('DB06 isolated startup environment', () => {
  it('disables scheduled writes and supplies only explicit synthetic application config', () => {
    const env = sprint3FinalEnvironment(
      {
        PATH: '/runtime/bin',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://private.example/production',
        OMISE_PUBLIC_KEY: 'real-public-key',
        OMISE_SECRET_KEY: 'real-secret-key',
        RESEND_API_KEY: 'real-email-key',
        WEB_ORIGIN: 'https://private.example',
        AWS_SECRET_ACCESS_KEY: 'ambient-cloud-secret',
        NODE_OPTIONS: '--require=ambient-loader',
      },
      'postgresql://tester@localhost/hktutor_s3_db06_test',
    );
    expect(env['NODE_ENV']).toBe('test');
    expect(env['DATABASE_URL']).toBe('postgresql://tester@localhost/hktutor_s3_db06_test');
    expect(env['PATH']).toBe('/runtime/bin');
    expect(env['OMISE_SECRET_KEY']).toBe('');
    expect(env['OMISE_WEBHOOK_SECRET']).toBe('');
    expect(env['RESEND_API_KEY']).toBe('re_db06_synthetic');
    for (const key of ['OMISE_PUBLIC_KEY', 'WEB_ORIGIN', 'AWS_SECRET_ACCESS_KEY', 'NODE_OPTIONS']) {
      expect(env[key]).toBeUndefined();
    }
    expect(env['JWT_ACCESS_SECRET']).toHaveLength(96);
    expect(env['JWT_REFRESH_SECRET']).not.toBe(env['JWT_ACCESS_SECRET']);
  });
});

describe('DB06 safe failure diagnostics', () => {
  it('keeps the failed child and exit status actionable', () => {
    expect(
      sprint3FinalDiagnostic(new Error('verify-admin-coupons.ts failed (1)'), 'admin audit'),
    ).toContain('verify-admin-coupons.ts failed (1)');
  });
  it('names the checkpoint, error type and connection code without raw connection values', () => {
    const error = Object.assign(new Error('postgresql://user:private-password@shared.example/db'), {
      code: 'ECONNREFUSED',
    });
    const diagnostic = sprint3FinalDiagnostic(error, 'database preflight');
    expect(diagnostic).toContain('database preflight');
    expect(diagnostic).toContain('Error');
    expect(diagnostic).toContain('ECONNREFUSED');
    expect(diagnostic).not.toContain('private-password');
    expect(diagnostic).not.toContain('shared.example');
  });
  it('identifies the invalid config field without displaying its value', () => {
    const diagnostic = sprint3FinalDiagnostic(
      new Error('SUPABASE_URL must be an HTTPS origin; rejected private-value'),
      'API startup',
    );
    expect(diagnostic).toContain('SUPABASE_URL');
    expect(diagnostic).not.toContain('private-value');
  });
  it('identifies a child timeout without exposing its cause', () => {
    const error = Object.assign(new Error('private child detail'), { name: 'AbortError' });
    const diagnostic = sprint3FinalDiagnostic(error, 'fixture verifier');
    expect(diagnostic).toContain('fixture verifier');
    expect(diagnostic).toContain('180');
    expect(diagnostic).not.toContain('private child detail');
  });
  it('never prints arbitrary errors, raw provider payloads or assertion values', () => {
    for (const error of [
      new Error('Bearer private-token; {"secret":"private-value"}'),
      new assert.AssertionError({
        actual: 'private-value',
        expected: 'other',
        operator: 'strictEqual',
      }),
      { name: 'private-token', message: 'private-value', code: 'https://secret.example' },
      'private-value',
    ]) {
      const diagnostic = sprint3FinalDiagnostic(error, 'HTTP health');
      expect(diagnostic).toContain('HTTP health');
      expect(diagnostic).not.toContain('private-');
      expect(diagnostic).not.toContain('secret.example');
    }
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

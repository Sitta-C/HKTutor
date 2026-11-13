import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Pool } from 'pg';

import { disposableDatabaseUrl } from '@config/disposable-database-url';

import type { AppModule as AppModuleType } from '@app/app.module';
import type { configureApplication as ConfigureApplication } from '@app/app.setup';

let checkpoint = 'database preflight';

interface AppliedMigration {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export function disposableSprint3FinalDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return disposableDatabaseUrl(env, 'hktutor_s3_db06_test');
}

export function sprint3FinalEnvironment(
  env: NodeJS.ProcessEnv,
  databaseUrl: string,
): NodeJS.ProcessEnv {
  const isolated: NodeJS.ProcessEnv = {
    DATABASE_URL: databaseUrl,
    HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1',
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
    RESEND_API_KEY: 're_db06_synthetic',
    EMAIL_FROM: 'HKTutor <no-reply@example.invalid>',
    SUPABASE_URL: 'https://storage.example.invalid',
    SUPABASE_SECRET_KEY: 'sb_secret_db06_synthetic',
    SUPABASE_AVATAR_BUCKET: 'db06-avatars',
    SUPABASE_DOCUMENT_BUCKET: 'db06-documents',
    PAYMENT_PROVIDER: 'omise',
    OMISE_SECRET_KEY: '',
    OMISE_WEBHOOK_SECRET: '',
  };
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
  ]) {
    if (env[key] !== undefined) {
      isolated[key] = env[key];
    }
  }
  return isolated;
}

export function sprint3FinalDiagnostic(error: unknown, stage: string): string {
  const name =
    error instanceof Error && /^[A-Z][A-Za-z]{0,79}$/.test(error.name) ? error.name : 'Error';
  const code =
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^(?:E[A-Z_]{2,30}|ABORT_ERR|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|P\d{4}|\d{2}[A-Z0-9]{3}|XX000)$/.test(
      error.code,
    )
      ? ` (${error.code})`
      : '';
  let detail = 'Inspect this checkpoint; raw error details are omitted.';
  if (error instanceof Error) {
    if (
      /^verify-(?:sprint3-fixtures|admin-coupons)\.ts failed \((?:\d+|SIG[A-Z]+)\)$/.test(
        error.message,
      )
    ) {
      detail = error.message;
    } else if (name === 'AbortError') {
      detail = 'Child verifier exceeded its 180-second timeout.';
    } else {
      const field = /^([A-Z][A-Z0-9_]+) (?:is required|must )/.exec(error.message)?.[1];
      if (field) {
        detail = `${field} configuration is missing or invalid.`;
      }
    }
  }
  return `DB06 ${stage}: ${name}${code}. ${detail}\n`;
}

export function assertMigrationHistory(
  committed: { name: string; checksum: string }[],
  applied: AppliedMigration[],
): void {
  const expected = committed.map(({ name, checksum }) => [name, checksum, true]).sort();
  const actual = applied
    .filter(({ rolled_back_at }) => rolled_back_at === null)
    .map(({ migration_name, checksum, finished_at }) => [
      migration_name,
      checksum,
      finished_at !== null,
    ])
    .sort();
  assert.deepEqual(actual, expected, 'Completed migration names and file checksums must match');
}

async function runVerifier(filename: string, env: NodeJS.ProcessEnv): Promise<void> {
  process.stdout.write(`DB06 running ${filename}\n`);
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', resolve(__dirname, filename)],
    {
      cwd: resolve(__dirname, '..'),
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
      signal: AbortSignal.timeout(180_000),
    },
  );
  await new Promise<void>((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        done();
      } else {
        reject(new Error(`${filename} failed (${signal ?? code})`));
      }
    });
  });
}

async function verify(): Promise<void> {
  const databaseUrl = disposableSprint3FinalDatabaseUrl(process.env);
  const originalEnvironment = { ...process.env };
  const isolatedEnvironment = sprint3FinalEnvironment(process.env, databaseUrl);
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, isolatedEnvironment);
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    assert.deepEqual(
      (await pool.query('SELECT current_database() AS database, current_schema() AS schema')).rows,
      [{ database: 'hktutor_s3_db06_test', schema: 'public' }],
    );
    assert.equal(
      (await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM "User"')).rows[0]
        ?.count,
      0,
      'Use a new empty disposable database after migration deploy',
    );
    checkpoint = 'migration history';
    const migrationRoot = resolve(__dirname, '../prisma/migrations');
    const committed = [];
    for (const entry of await readdir(migrationRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const checksum = createHash('sha256')
          .update(await readFile(resolve(migrationRoot, entry.name, 'migration.sql')))
          .digest('hex');
        committed.push({ name: entry.name, checksum });
      }
    }
    assertMigrationHistory(
      committed,
      (await pool.query<AppliedMigration>('SELECT * FROM "_prisma_migrations"')).rows,
    );
    process.stdout.write(`PASS DB06 ${committed.length} migration names/checksums match\n`);
    for (const { name, checksum } of committed.sort((a, b) => a.name.localeCompare(b.name))) {
      process.stdout.write(`migration ${name} sha256=${checksum}\n`);
    }
    checkpoint = 'fixture verifier';
    await runVerifier('verify-sprint3-fixtures.ts', isolatedEnvironment);
    checkpoint = 'admin audit verifier';
    await runVerifier('verify-admin-coupons.ts', isolatedEnvironment);

    checkpoint = 'persisted coverage';

    const types = (
      await pool.query<{ eventType: string }>(
        `SELECT DISTINCT "eventType" FROM "Notification" WHERE "eventType" LIKE '%REMINDER%' ORDER BY "eventType"`,
      )
    ).rows.map(({ eventType }) => eventType);
    assert.deepEqual(types, [
      'CLASS_REMINDER_1H',
      'CLASS_REMINDER_24H',
      'PAYMENT_REMINDER_1H',
      'PAYMENT_REMINDER_24H',
    ]);
    const actions = (
      await pool.query<{ action: string }>('SELECT DISTINCT action FROM "AuditLog" ORDER BY action')
    ).rows.map(({ action }) => action);
    assert.deepEqual(actions, [
      'coupon.active_change',
      'coupon.consume',
      'coupon.create',
      'coupon.release',
      'coupon.reserve',
    ]);
    process.stdout.write(
      'PASS DB06 all four reminder types and five coupon audit actions persisted\n',
    );

    async function persistenceHashes(): Promise<{ table: string; hash: string }[]> {
      const hashes: { table: string; hash: string }[] = [];
      for (const table of [
        'Booking',
        'PaymentAttempt',
        'CouponReservation',
        'CouponUse',
        'Notification',
        'AuditLog',
      ]) {
        const result = await pool.query<{ hash: string }>(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text, '[]')) AS hash FROM "${table}" t`,
        );
        assert.ok(result.rows[0]);
        hashes.push({ table, hash: result.rows[0].hash });
      }
      return hashes;
    }
    const beforeStartup = await persistenceHashes();
    checkpoint = 'startup isolation';
    const originalDirectory = process.cwd();
    const temporary = await mkdtemp(resolve(tmpdir(), 'hktutor-db06-startup-'));
    const workingDirectory = resolve(temporary, 'empty', 'runtime');
    await mkdir(workingDirectory, { recursive: true });
    const originalFetch = globalThis.fetch;
    let externalCalls = 0;
    globalThis.fetch = () => {
      externalCalls += 1;
      return Promise.reject(new Error('External calls are forbidden during DB06 startup'));
    };
    try {
      // AppModule reads ../../.env and .env; both paths stay inside this new empty directory tree.
      process.chdir(workingDirectory);
      // Import only after isolating environment-file paths and supplying synthetic configuration.
      checkpoint = 'API startup';
      const { AppModule } = createRequire(__filename)('@app/app.module') as {
        AppModule: typeof AppModuleType;
      };
      const { configureApplication } = createRequire(__filename)('@app/app.setup') as {
        configureApplication: typeof ConfigureApplication;
      };
      const app = await NestFactory.create(AppModule, {
        logger: false,
        rawBody: true,
        abortOnError: false,
      });
      try {
        configureApplication(app);
        await app.listen(0, '127.0.0.1');
        assert.equal(
          app.get(SchedulerRegistry).getCronJob('class-and-payment-reminders').isActive,
          false,
          'Startup reminder cron must remain disabled',
        );
        checkpoint = 'HTTP health';
        const response = await originalFetch(`${await app.getUrl()}/api/v1/health`, {
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { database: 'connected' });
        assert.equal(externalCalls, 0, 'Startup must not call external services');
        process.stdout.write('PASS DB06 full AppModule startup and real HTTP health after seed\n');
      } finally {
        await app.close();
      }
    } finally {
      globalThis.fetch = originalFetch;
      process.chdir(originalDirectory);
      await rm(temporary, { recursive: true, force: true });
    }
    checkpoint = 'startup persistence';
    assert.deepEqual(
      await persistenceHashes(),
      beforeStartup,
      'Startup must preserve seeded evidence',
    );
    process.stdout.write('PASS DB06 startup cron disabled and six evidence tables unchanged\n');
    process.stdout.write(
      'DB06 clean seed/startup complete; run upgrade, reminders and DB05 on separate fresh targets per runbook.\n',
    );
  } finally {
    await pool.end();
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnvironment);
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(sprint3FinalDiagnostic(error, checkpoint));
    process.exitCode = 1;
  });
}

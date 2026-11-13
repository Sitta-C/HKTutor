import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';

import { configureApplication } from '@app/app.setup';
import { buildSprint3Fixtures } from '@infrastructure/database/seed/sprint3-fixtures';

import type { AppModule as AppModuleType } from '@app/app.module';

interface AppliedMigration {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export function disposableSprint3FinalDatabaseUrl(env: NodeJS.ProcessEnv): string {
  assert.equal(
    env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable opt-in required',
  );
  const value = env['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required; this runner never loads .env');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(
    url.pathname,
    '/hktutor_s3_db06_test',
    'Dedicated DB06 disposable database required',
  );
  assert.equal(url.search, '', 'URL options are not accepted');
  assert.equal(url.hash, '', 'URL fragments are not accepted');
  return value;
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

async function runVerifier(filename: string): Promise<void> {
  process.stdout.write(`DB06 running ${filename}\n`);
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', resolve(__dirname, filename)],
    {
      cwd: resolve(__dirname, '..'),
      env: process.env,
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
    process.stdout.write(
      `DB04 fixture input sha256=${createHash('sha256').update(JSON.stringify(buildSprint3Fixtures())).digest('hex')}\n`,
    );
    await runVerifier('verify-sprint3-fixtures.ts');
    await runVerifier('verify-admin-coupons.ts');

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
      Object.assign(process.env, {
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'development',
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
      });
      // Import only after isolating environment-file paths and supplying synthetic configuration.
      const { AppModule } = createRequire(__filename)('@app/app.module') as {
        AppModule: typeof AppModuleType;
      };
      const app = await NestFactory.create(AppModule, {
        logger: false,
        rawBody: true,
        abortOnError: false,
      });
      try {
        configureApplication(app);
        await app.listen(0, '127.0.0.1');
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
    process.stdout.write(
      'DB06 clean seed/startup complete; run upgrade, reminders and DB05 on separate fresh targets per runbook.\n',
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      error instanceof assert.AssertionError
        ? `DB06 assertion: ${error.message}\n`
        : 'DB06 verification failed; inspect the last sanitized checkpoint.\n',
    );
    process.exitCode = 1;
  });
}

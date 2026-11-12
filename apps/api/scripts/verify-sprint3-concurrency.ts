import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';

export function disposableSprint3ConcurrencyDatabaseUrl(env: NodeJS.ProcessEnv): string {
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
    '/hktutor_s3_db05_test',
    'Dedicated DB05 disposable database required',
  );
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return value;
}

async function runScript(filename: string): Promise<void> {
  process.stdout.write(`DB05 running ${filename}\n`);
  const args = filename.endsWith('.ts')
    ? ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register']
    : [];
  const child = spawn(process.execPath, [...args, resolve(__dirname, filename)], {
    cwd: resolve(__dirname, '..'),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
    signal: AbortSignal.timeout(180_000),
  });
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
  const databaseUrl = disposableSprint3ConcurrencyDatabaseUrl(process.env);
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30_000,
  });
  try {
    const target = await pool.query<{ database: string; schema: string }>(
      'SELECT current_database() AS database, current_schema() AS schema',
    );
    assert.deepEqual(target.rows, [{ database: 'hktutor_s3_db05_test', schema: 'public' }]);
    const applied = await pool.query<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    for (const entry of await readdir(resolve(__dirname, '../prisma/migrations'), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        assert.ok(
          applied.rows.some((row) => row.migration_name === entry.name),
          `Missing migration ${entry.name}`,
        );
      }
    }
    assert.equal(
      (await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM "User"')).rows[0]
        ?.count,
      0,
      'Use a new empty disposable database',
    );
  } finally {
    await pool.end();
  }
  for (const filename of [
    'verify-review-submissions.ts',
    'verify-review-database.mjs',
    'verify-coupon-database.mjs',
    'verify-coupon-payments.ts',
    'verify-sprint3-query-plans.mjs',
  ]) {
    await runScript(filename);
  }
  process.stdout.write(
    'DB05 complete: five real-database verifier stages passed; discard the owned disposable database.\n',
  );
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      error instanceof assert.AssertionError
        ? `DB05 assertion: ${error.message}\n`
        : 'DB05 verification failed; inspect the last sanitized checkpoint.\n',
    );
    process.exitCode = 1;
  });
}

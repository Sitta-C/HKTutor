import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import test from 'node:test';

const parseEnvironment = (source) =>
  Object.fromEntries(
    source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        assert.notEqual(separator, -1, `Invalid environment entry: ${line}`);
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, '')];
      }),
  );

test('documents the required server-only and intentionally public environment values', async () => {
  const template = parseEnvironment(await fs.readFile('.env.example', 'utf8'));

  assert.deepEqual(Object.keys(template).sort(), [
    'CLERK_SECRET_KEY',
    'DATABASE_URL',
    'NEXT_PUBLIC_BACKEND_URL',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'SEED_ADMIN_CLERK_USER_ID',
    'SEED_ADMIN_EMAIL',
    'SEED_TUTOR_CLERK_USER_ID',
    'SEED_TUTOR_EMAIL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_URL',
    'WEB_ORIGIN',
  ]);
  assert.equal(
    template.DATABASE_URL,
    'postgresql://postgres.[PROJECT_REF]:[DB_PASSWORD]@[DB_REGION].pooler.supabase.com:5432/postgres?sslmode=require',
  );
  assert.equal(template.SUPABASE_URL, 'https://[PROJECT_REF].supabase.co');
  assert.equal(template.SUPABASE_SECRET_KEY, 'sb_secret_[REPLACE_ME]');
  assert.equal(template.SEED_ADMIN_CLERK_USER_ID, '[ADMIN_CLERK_USER_ID]');
  assert.equal(template.SEED_ADMIN_EMAIL, '[ADMIN_EMAIL]');
  assert.equal(template.SEED_TUTOR_CLERK_USER_ID, '[TUTOR_CLERK_USER_ID]');
  assert.equal(template.SEED_TUTOR_EMAIL, '[TUTOR_EMAIL]');
  assert.equal(template.CLERK_SECRET_KEY, '[CLERK_SECRET_KEY]');
  assert.equal(template.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, '[NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY]');
  assert.equal(template.NEXT_PUBLIC_BACKEND_URL, 'http://localhost:3001');
  assert.equal(template.WEB_ORIGIN, 'http://localhost:3000');
  assert.deepEqual(
    Object.keys(template)
      .filter((name) => name.startsWith('NEXT_PUBLIC_'))
      .sort(),
    ['NEXT_PUBLIC_BACKEND_URL', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'],
  );
});

test('ignores local environment files but keeps the safe template trackable', () => {
  const local = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '.env']);
  const template = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '.env.example']);

  assert.equal(local.status, 0, '.env must remain ignored');
  assert.notEqual(template.status, 0, '.env.example must remain trackable');
});

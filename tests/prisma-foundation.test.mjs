import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));

test('pins the approved Prisma stack in the API package', async () => {
  const api = await readJson('apps/api/package.json');

  assert.equal(api.dependencies['@prisma/client'], '7.10.0');
  assert.equal(api.dependencies['@prisma/adapter-pg'], '7.10.0');
  assert.equal(api.devDependencies.prisma, '7.10.0');
  assert.equal(typeof api.dependencies.pg, 'string');
  assert.equal(typeof api.dependencies['@nestjs/config'], 'string');
  assert.equal(typeof api.dependencies.dotenv, 'string');
  assert.equal(typeof api.devDependencies['@types/pg'], 'string');
  assert.equal(typeof api.devDependencies.tsx, 'string');
});

test('exposes database commands from the API and workspace root', async () => {
  const root = await readJson('package.json');
  const api = await readJson('apps/api/package.json');
  const commands = [
    'db:generate',
    'db:validate',
    'db:migrate:deploy',
    'db:migrate:status',
    'db:seed',
  ];

  for (const command of commands) {
    assert.equal(typeof api.scripts[command], 'string');
    assert.match(root.scripts[command], /pnpm --filter @hktutor\/api/);
  }
});

test('the foundation migration enables only the required PostgreSQL extensions', async () => {
  const sql = await fs.readFile(
    'apps/api/prisma/migrations/20260830000000_enable_required_extensions/migration.sql',
    'utf8',
  );

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions/i);
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions/i);
  assert.doesNotMatch(sql, /CREATE\s+TABLE/i);
});

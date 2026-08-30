import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));

test('API declares the Swagger and class-based validation runtime dependencies', async () => {
  const api = await readJson('apps/api/package.json');

  for (const dependency of ['@nestjs/swagger', 'class-transformer', 'class-validator']) {
    assert.equal(
      typeof api.dependencies[dependency],
      'string',
      `${dependency} must be an API runtime dependency`,
    );
  }
});

test('CI runs the complete workspace check with the pinned toolchain', async () => {
  const workflow = await fs.readFile('.github/workflows/ci.yml', 'utf8');

  assert.match(workflow, /^permissions:\s*\n\s+contents: read$/m);
  assert.match(workflow, /^\s{2}push:\s*$/m);
  assert.match(workflow, /^\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- main$/m);
  assert.match(workflow, /^\s{2}pull_request:\s*$/m);
  assert.match(workflow, /node-version: ['"]?24\.19\.0['"]?/);
  assert.match(workflow, /version: ['"]?11\.19\.0['"]?/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
  assert.match(workflow, /pnpm check/);
  assert.doesNotMatch(workflow, /DATABASE_URL|SUPABASE_(?:SECRET|SERVICE_ROLE)_KEY/);
});

test('workspace check generates Prisma Client before linting', async () => {
  const workspace = await readJson('package.json');
  const checkSteps = workspace.scripts.check.split(' && ');

  assert.equal(checkSteps[0], 'pnpm db:generate');
  assert.ok(checkSteps.indexOf('pnpm db:generate') < checkSteps.indexOf('pnpm lint'));
});

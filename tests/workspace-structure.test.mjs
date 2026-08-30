import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));

test('defines the approved pnpm workspace', async () => {
  const root = await readJson('package.json');
  const workspace = await fs.readFile('pnpm-workspace.yaml', 'utf8');
  assert.equal(root.private, true);
  assert.equal(root.packageManager, 'pnpm@11.19.0');
  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
  for (const script of ['dev', 'build', 'test', 'lint', 'format', 'format:check', 'check']) {
    assert.equal(typeof root.scripts[script], 'string');
  }
  assert.match(root.scripts.check, /format:check/);
});

test('defines buildable web and API packages', async () => {
  const web = await readJson('apps/web/package.json');
  const api = await readJson('apps/api/package.json');
  assert.equal(web.name, '@hktutor/web');
  assert.equal(api.name, '@hktutor/api');
  assert.equal(typeof web.scripts.build, 'string');
  assert.equal(typeof api.scripts.build, 'string');
  assert.equal(web.devDependencies['@hktutor/tsconfig'], 'workspace:*');
  assert.equal(api.devDependencies['@hktutor/tsconfig'], 'workspace:*');
  assert.equal(web.devDependencies['@hktutor/eslint-config'], 'workspace:*');
  assert.equal(api.devDependencies['@hktutor/eslint-config'], 'workspace:*');
});

test('reserves web port 3000 while allowing PORT to select the API port', async () => {
  const web = await readJson('apps/web/package.json');
  const api = await readJson('apps/api/package.json');
  const apiBootstrap = await fs.readFile('apps/api/src/main.ts', 'utf8');

  assert.match(web.scripts.dev, /next dev --port 3000/);
  assert.doesNotMatch(api.scripts.dev, /PORT\s*=/);
  assert.match(apiBootstrap, /process\.env\[['"]PORT['"]\] \?\? 3001/);
});

test('keeps API lint read-only and fails on warnings', async () => {
  const api = await readJson('apps/api/package.json');

  assert.doesNotMatch(api.scripts.lint, /--fix/);
  assert.match(api.scripts.lint, /--max-warnings=0/);
  assert.match(api.scripts['lint:fix'], /--fix/);
});

test('extends the shared strict TypeScript baseline', async () => {
  const shared = await readJson('packages/tsconfig/base.json');
  const web = await readJson('apps/web/tsconfig.json');
  const api = await readJson('apps/api/tsconfig.json');
  assert.equal(shared.compilerOptions.strict, true);
  assert.equal(shared.compilerOptions.exactOptionalPropertyTypes, true);
  assert.equal(shared.compilerOptions.noImplicitOverride, true);
  assert.equal(shared.compilerOptions.noImplicitReturns, true);
  assert.equal(shared.compilerOptions.noPropertyAccessFromIndexSignature, undefined);
  assert.equal(api.compilerOptions.noPropertyAccessFromIndexSignature, true);
  assert.equal(web.extends, '@hktutor/tsconfig/base.json');
  assert.equal(api.extends, '@hktutor/tsconfig/base.json');
});

test('keeps later-sprint infrastructure out while allowing Prisma only in the API', async () => {
  const root = await readJson('package.json');
  const web = await readJson('apps/web/package.json');
  const api = await readJson('apps/api/package.json');
  const forbidden = /redis|bullmq|bee-queue|amqplib|socket\.io|@supabase\/supabase-js|docker/i;
  for (const manifest of [root, web, api]) {
    const names = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    assert.equal(
      names.some((name) => forbidden.test(name)),
      false,
    );
  }

  const prismaPackage = /^(?:@prisma\/|prisma$)/;
  for (const manifest of [root, web]) {
    const names = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    assert.equal(
      names.some((name) => prismaPackage.test(name)),
      false,
    );
  }
});

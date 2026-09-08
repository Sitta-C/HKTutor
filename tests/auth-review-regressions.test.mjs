import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

test('keeps Clerk dependencies in the workspace packages that import them', async () => {
  const [rootPackage, apiPackage, webPackage] = await Promise.all([
    readJson('package.json'),
    readJson('apps/api/package.json'),
    readJson('apps/web/package.json'),
  ]);

  assert.equal(rootPackage.dependencies?.['@clerk/backend'], undefined);
  assert.equal(rootPackage.dependencies?.['@clerk/nextjs'], undefined);
  assert.equal(apiPackage.dependencies['@clerk/backend'], '^3.17.0');
  assert.equal(webPackage.dependencies['@clerk/nextjs'], '^7.8.4');
});

test('does not register the public Clerk token test endpoint', async () => {
  const appModule = await fs.readFile('apps/api/src/app.module.ts', 'utf8');

  assert.doesNotMatch(appModule, /TestModule|testAPI/);
  await assert.rejects(fs.access('apps/api/src/testAPI/test.controller.ts'));
});

test('uses the browser-visible Clerk publishable key name', async () => {
  const authModule = await fs.readFile('apps/api/src/auth/auth.module.ts', 'utf8');

  assert.match(authModule, /process\.env\['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'\]/);
  assert.doesNotMatch(authModule, /process\.env\['CLERK_PUBLISHABLE_KEY'\]/);
});

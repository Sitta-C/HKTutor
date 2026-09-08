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

test('uses deployable Clerk, API, and CORS environment names', async () => {
  const [authModule, bootstrap] = await Promise.all([
    fs.readFile('apps/api/src/auth/auth.module.ts', 'utf8'),
    fs.readFile('apps/api/src/main.ts', 'utf8'),
  ]);

  assert.match(authModule, /process\.env\['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'\]/);
  assert.doesNotMatch(authModule, /process\.env\['CLERK_PUBLISHABLE_KEY'\]/);
  assert.match(bootstrap, /process\.env\['WEB_ORIGIN'\]/);
});

test('always clears the login loading state', async () => {
  const login = await fs.readFile('apps/web/src/components/login.tsx', 'utf8');

  assert.match(login, /finally\s*{\s*setIsLoading\(false\);\s*}/s);
});

test('persists the selected registration role in Clerk metadata', async () => {
  const register = await fs.readFile('apps/web/src/components/register.tsx', 'utf8');

  assert.match(register, /signUp\.password\(\{[\s\S]*unsafeMetadata:\s*\{\s*role\s*}/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const requireFromWeb = createRequire(path.resolve('apps/web/package.json'));
const ts = requireFromWeb('typescript');

const helperPath = 'apps/web/src/lib/onboarding.ts';

const importTranspiledHelper = async (t) => {
  const source = await fs.readFile(helperPath, 'utf8');
  assert.doesNotMatch(source, /^\s*import\b/m, 'the helper must stay dependency-free');
  assert.doesNotMatch(source, /fetchWithAuth/, 'the helper must not depend on @/api/Token');

  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const modulePath = path.join(
    os.tmpdir(),
    `hktutor-onboarding-helper-${process.pid}-${Date.now()}.mjs`,
  );
  await fs.writeFile(modulePath, transpiled);
  t.after(() => fs.rm(modulePath, { force: true }));

  return import(pathToFileURL(modulePath).href);
};

const stubFetch = (t, calls) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return calls.length === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
};

test('a failed onboarding POST retries through the same endpoint, payload, and token', async (t) => {
  const { submitOnboarding } = await importTranspiledHelper(t);

  const calls = [];
  stubFetch(t, calls);

  const getToken = async () => 'jwt';
  const baseUrl = 'https://api.example.test';
  const payload = { consent: true, policyVersion: '2026-08-01', role: 'tutor' };

  const first = await submitOnboarding(getToken, baseUrl, payload);
  assert.deepEqual(first, { ok: false, status: 500 });

  const retry = await submitOnboarding(getToken, baseUrl, payload);
  assert.deepEqual(retry, { ok: true, status: 200 });

  assert.equal(calls.length, 2, 'each submission must issue exactly one POST');
  for (const call of calls) {
    assert.equal(call.input, 'https://api.example.test/api/users/onboarding');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, 'Bearer jwt');
    assert.deepEqual(JSON.parse(call.init.body), payload);
  }
  assert.equal(
    JSON.parse(calls[0].init.body).role,
    JSON.parse(calls[1].init.body).role,
    'the retry must carry the same payload as the first attempt',
  );
});

test('a missing session token throws OnboardingTokenError without calling fetch', async (t) => {
  const { submitOnboarding, OnboardingTokenError } = await importTranspiledHelper(t);

  const calls = [];
  stubFetch(t, calls);

  const getToken = async () => null;

  await assert.rejects(
    submitOnboarding(getToken, 'https://api.example.test', {
      consent: true,
      policyVersion: '2026-08-01',
      role: 'student',
    }),
    (error) => error instanceof OnboardingTokenError,
  );
  assert.equal(calls.length, 0, 'no fetch may happen without a token');
});

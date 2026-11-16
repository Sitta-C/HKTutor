import assert from 'node:assert/strict';
import test from 'node:test';

import { createE11DemoEnvironment } from '../scripts/run-e11-demo.mjs';

test('E11 uses the development database from .env instead of an inherited container target', () => {
  const target = 'postgresql://synthetic:synthetic@dev.example.test:5432/postgres?sslmode=require';
  const env = createE11DemoEnvironment(`DATABASE_URL="${target}"\n`, {
    DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:55432/hktutor_e11_demo_test',
    PATH: 'preserved-path',
  });
  assert.equal(env.DATABASE_URL, target);
  assert.equal(env.PATH, 'preserved-path');
  assert.equal(env.HKTUTOR_E11_DEMO_TARGET, 'development');
});

test('E11 isolates repeated runs with fresh identities, passwords, tokens and signing secrets', () => {
  const source = 'DATABASE_URL=postgresql://synthetic:synthetic@dev.example.test/postgres';
  const first = createE11DemoEnvironment(source, {});
  const second = createE11DemoEnvironment(source, {});
  assert.match(
    first.HKTUTOR_E11_DEMO_RUN_ID,
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
  );
  for (const key of [
    'HKTUTOR_E11_DEMO_RUN_ID',
    'HKTUTOR_E11_DEMO_PASSWORD',
    'HKTUTOR_E11_DEMO_TOKEN_SECRET',
    'HKTUTOR_E11_DEMO_ACCESS_SECRET',
    'HKTUTOR_E11_DEMO_REFRESH_SECRET',
  ]) {
    assert.notEqual(first[key], second[key]);
    assert.ok(first[key].length >= 32);
  }
  assert.notEqual(first.HKTUTOR_E11_DEMO_ACCESS_SECRET, first.HKTUTOR_E11_DEMO_REFRESH_SECRET);
});

test('E11 rejects missing or invalid file configuration without exposing credentials', () => {
  for (const source of [
    '',
    'DATABASE_URL=invalid',
    'DATABASE_URL=https://synthetic:private@example.test',
  ]) {
    assert.throws(() => createE11DemoEnvironment(source, {}), /DATABASE_URL/);
    try {
      createE11DemoEnvironment(source, {});
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes('private'));
    }
  }
});

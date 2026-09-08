import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_replace_clerk_with_local_jwt_auth';

const read = (file) => fs.readFile(file, 'utf8');
const readJson = async (file) => JSON.parse(await read(file));

async function readLocalAuthMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix),
  );
  assert.equal(matches.length, 1, 'the one-shot local-auth migration must exist exactly once');
  return read(path.join(migrationsRoot, matches[0].name, 'migration.sql'));
}

test('uses local JWT and email dependencies with no Clerk package', async () => {
  const [api, web] = await Promise.all([
    readJson('apps/api/package.json'),
    readJson('apps/web/package.json'),
  ]);
  const dependencyNames = [
    ...Object.keys(api.dependencies ?? {}),
    ...Object.keys(api.devDependencies ?? {}),
    ...Object.keys(web.dependencies ?? {}),
    ...Object.keys(web.devDependencies ?? {}),
  ];

  assert.equal(
    dependencyNames.some((name) => name.startsWith('@clerk/')),
    false,
  );
  for (const name of ['argon2', 'jsonwebtoken', 'resend', '@nestjs/throttler']) {
    assert.equal(typeof api.dependencies[name], 'string', `${name} must be an API dependency`);
  }
});

test('defines local credentials, verification tokens, and revocable sessions', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');

  assert.match(schema, /model User\s*{[\s\S]*email\s+String\s+@db\.Citext/);
  assert.match(schema, /model User\s*{[\s\S]*passwordHash\s+String\?/);
  assert.match(schema, /model User\s*{[\s\S]*emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /model EmailVerificationToken\s*{[\s\S]*tokenHash\s+String\s+@unique/);
  assert.match(schema, /model AuthSession\s*{[\s\S]*refreshTokenHash\s+String\s+@unique/);
  assert.match(schema, /model AuthSession\s*{[\s\S]*revokedAt\s+DateTime\?/);
  assert.doesNotMatch(schema, /clerkUserId|ClerkWebhookEvent|ClerkWebhookStatus/);
});

test('one-shot migration clears only the demo identity graph and installs local auth tables', async () => {
  const sql = await readLocalAuthMigration();

  assert.match(sql, /^BEGIN;/i);
  assert.match(sql, /LOCK TABLE[\s\S]*"User"[\s\S]*ACCESS EXCLUSIVE MODE/i);
  for (const table of ['Booking', 'AvailabilitySlot', 'TeachingListing', 'TutorProfile', 'User']) {
    assert.match(sql, new RegExp(`DELETE FROM "${table}"`, 'i'));
  }
  assert.doesNotMatch(sql, /DELETE FROM "(?:Subject|GradeLevel)"/i);
  assert.match(sql, /ALTER TABLE "User" RENAME COLUMN "primaryEmail" TO "email"/i);
  assert.match(sql, /DROP COLUMN "clerkUserId"/i);
  assert.match(sql, /CREATE TABLE "EmailVerificationToken"/i);
  assert.match(sql, /CREATE TABLE "AuthSession"/i);
  assert.match(sql, /ON DELETE CASCADE ON UPDATE CASCADE/i);
  assert.match(sql, /COMMIT;\s*$/i);
  assert.doesNotMatch(sql, /postgresql:\/\/|sk_live_|re_[A-Za-z0-9]/i);
});

test('verifies JWT signatures and keeps refresh tokens out of response bodies', async () => {
  const [jwtService, controller, authService, emailService] = await Promise.all([
    read('apps/api/src/auth/jwt.service.ts'),
    read('apps/api/src/auth/auth.controller.ts'),
    read('apps/api/src/auth/auth.service.ts'),
    read('apps/api/src/email/email.service.ts'),
  ]);

  assert.match(jwtService, /jwt\.verify\(/);
  assert.doesNotMatch(jwtService, /jwt\.decode\(/);
  assert.match(controller, /response\.cookie\(REFRESH_COOKIE_NAME/);
  assert.match(controller, /Omit<AuthResult, 'refreshToken'>/);
  assert.match(authService, /createHash\('sha256'\)/);
  assert.match(authService, /timingSafeEqual/);
  assert.match(emailService, /new Resend\(/);
});

test('web keeps access tokens in memory and sends refresh cookies as credentials', async () => {
  const [client, layout, proxy] = await Promise.all([
    read('apps/web/src/lib/auth-client.ts'),
    read('apps/web/src/app/layout.tsx'),
    read('apps/web/src/proxy.ts'),
  ]);

  assert.match(client, /let accessToken: string \| null = null/);
  assert.match(client, /credentials: 'include'/);
  assert.match(client, /Bearer \$\{accessToken\}/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.match(layout, /<AuthProvider>/);
  assert.match(proxy, /hktutor_refresh/);
});

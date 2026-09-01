import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationsRoot = 'apps/api/prisma/migrations';
const userRoleMigrationSuffix = '_add_user_role_foundation';

async function readUserRoleMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(userRoleMigrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'S1-T07 user-role migration must exist exactly once');

  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('defines the Clerk-backed Sprint 1 user identity model', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');

  assert.match(schema, /enum Role\s*{[\s\S]*STUDENT[\s\S]*TUTOR[\s\S]*ADMIN[\s\S]*}/);
  assert.match(schema, /enum AccountStatus\s*{[\s\S]*ACTIVE[\s\S]*SUSPENDED[\s\S]*DELETED[\s\S]*}/);
  assert.match(schema, /enum ClerkWebhookStatus\s*{[\s\S]*PROCESSED[\s\S]*FAILED[\s\S]*}/);
  assert.match(schema, /model User\s*{[\s\S]*clerkUserId\s+String\s+@unique/);
  assert.match(schema, /primaryEmail\s+String\?\s+@db\.Citext/);
  assert.doesNotMatch(schema, /passwordHash\s+String/);
  assert.match(schema, /role\s+Role/);
  assert.match(schema, /accountStatus\s+AccountStatus\s+@default\(ACTIVE\)/);
  assert.match(schema, /consentAcceptedAt\s+DateTime\?/);
  assert.match(schema, /policyVersion\s+String\?/);
  assert.match(schema, /deletedAt\s+DateTime\?/);
  assert.match(schema, /model ClerkWebhookEvent\s*{[\s\S]*eventId\s+String\s+@id/);
  assert.match(schema, /model ClerkWebhookEvent\s*{[\s\S]*status\s+ClerkWebhookStatus/);
  assert.match(schema, /model ClerkWebhookEvent\s*{[\s\S]*clerkUserId\s+String/);
  assert.match(schema, /model ClerkWebhookEvent\s*{[\s\S]*processedAt\s+DateTime/);
  assert.match(schema, /model ClerkWebhookEvent\s*{[\s\S]*payloadHash\s+String\?/);
  assert.match(schema, /@@index\(\[clerkUserId\]/);
});

test('retains the historical forward-only user-role migration', async () => {
  const sql = await readUserRoleMigration();

  assert.match(sql, /CREATE TYPE "Role" AS ENUM \('student', 'tutor', 'admin'\)/i);
  assert.match(sql, /CREATE TYPE "AccountStatus" AS ENUM \('active', 'suspended', 'deleted'\)/i);
  assert.match(sql, /CREATE TABLE "User"/i);
  assert.match(sql, /"email"\s+extensions\.citext\s+NOT NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX "User_email_key" ON "User"\("email"\)/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN)/i);
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const migration = 'apps/api/prisma/migrations/20261109120000_add_coupon_persistence/migration.sql';

// Runtime constraints/races are proved by db:verify:coupons; these protect the repository boundary.
test('S3-DB02 exposes canonical coupon evidence without changing payment money fields', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  for (const name of ['Coupon', 'CouponUse', 'CouponReservation', 'AuditLog']) {
    assert.match(schema, new RegExp(`model ${name}\\s*{`));
  }
  assert.match(schema, /code\s+String\s+@unique @db.Citext/);
  for (const name of ['CouponUse', 'CouponReservation']) {
    const body = schema.match(new RegExp(`model ${name}\\s*{([\\s\\S]*?)\\n}`))?.[1];
    assert.ok(body);
    assert.match(body, /discountAmount\s+Decimal\s+@db.Decimal\(10, 2\)/);
    assert.match(body, /references: \[id, studentUserId\], onDelete: Restrict, onUpdate: Restrict/);
  }
  assert.match(schema, /paymentAttemptId\s+String\?\s+@unique @db.Uuid/);
  const sql = await fs.readFile(migration, 'utf8');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|INDEX|CONSTRAINT|COLUMN)|ALTER TABLE "Booking"/i);
  assert.match(sql, /"code" extensions.CITEXT/);
  assert.match(sql, /WHERE "status" IN \('RESERVED', 'CONSUMED'\)/);
  assert.match(sql, /WHERE "status" = 'RESERVED'/);
  assert.match(sql, /UPDATE "Booking" SET "id" = "id"/);
  assert.match(sql, /UPDATE "Coupon" SET "id" = "id"/);
  assert.match(sql, /used_count \+ reserved_count \+ 1 > capacity/);
  assert.match(sql, /INSERT INTO "CouponUse"/);
  assert.match(sql, /INSERT INTO "AuditLog"/);
});

test('S3-DB02 verification is explicit and separate from ordinary checks', async () => {
  const root = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const api = JSON.parse(await fs.readFile('apps/api/package.json', 'utf8'));
  assert.equal(root.scripts['db:verify:coupons'], 'pnpm --filter @hktutor/api db:verify:coupons');
  assert.equal(api.scripts['db:verify:coupons'], 'node scripts/verify-coupon-database.mjs');
  assert.doesNotMatch(root.scripts.check, /verify:coupons|migrate|seed/);
  const verifier = await fs.readFile('apps/api/scripts/verify-coupon-database.mjs', 'utf8');
  assert.match(verifier, /disposableDatabaseUrl\(\)/);
  assert.match(verifier, /pg_blocking_pids/);
  assert.doesNotMatch(verifier, /dotenv|ALTER TABLE|DISABLE TRIGGER/);
});

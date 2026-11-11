import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';

const migration =
  'apps/api/prisma/migrations/20261111120000_add_booking_coupon_snapshots/migration.sql';

test('DB03 retry correction preserves the applied migration and changes only its guard function', async () => {
  const original = await fs.readFile(migration);
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    '7b523caf8347cef3c4cd4a8ee6ade160bb1026bbaf9d332d699984c7e090a639',
    'The original DB03 migration has already been applied on dev',
  );
  const correction = await fs.readFile(
    'apps/api/prisma/migrations/20261111160000_preserve_coupon_reservation_retries/migration.sql',
    'utf8',
  );
  assert.match(correction, /^BEGIN;/);
  assert.match(correction, /COMMIT;\s*$/);
  assert.match(correction, /CREATE OR REPLACE FUNCTION "guard_reservation_price_snapshot"/);
  assert.doesNotMatch(correction, /\b(ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/);
});

test('DB03 adds nullable coupon evidence without rebuilding existing monetary columns or indexes', async () => {
  const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');
  for (const name of ['Booking', 'PaymentAttempt']) {
    const body = schema.match(new RegExp(`model ${name}\\s*{([\\s\\S]*?)\\n}`))?.[1];
    assert.ok(body);
    assert.match(body, /appliedCouponId\s+String\?\s+@db.Uuid/);
    assert.match(body, /appliedCouponCode\s+String\?\s+@db.VarChar\(32\)/);
    assert.match(body, /appliedCouponPercent\s+Int\?/);
    assert.match(
      body,
      /fields: \[appliedCouponId\], references: \[id\], onDelete: Restrict, onUpdate: Restrict/,
    );
  }
  const sql = await fs.readFile(migration, 'utf8');
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(
    sql,
    /DROP\s+(TABLE|INDEX|COLUMN)|ADD COLUMN "(subtotalAmount|discountAmount|netAmount|amount)"/i,
  );
  assert.doesNotMatch(
    sql,
    /UPDATE "Booking" SET "(subtotalAmount|discountAmount|netAmount|paymentStatus)"/,
  );
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /Provider attempt pricing is immutable/);
});

test('DB03 upgrade verification requires an opted-in empty disposable database', async () => {
  const root = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const api = JSON.parse(await fs.readFile('apps/api/package.json', 'utf8'));
  assert.equal(
    root.scripts['db:verify:booking-snapshots'],
    'pnpm --filter @hktutor/api db:verify:booking-snapshots',
  );
  assert.equal(
    api.scripts['db:verify:booking-snapshots'],
    'node scripts/verify-booking-snapshot-upgrade.mjs',
  );
  assert.doesNotMatch(root.scripts.check, /verify:booking-snapshots|migrate|seed/);
  const script = await fs.readFile('apps/api/scripts/verify-booking-snapshot-upgrade.mjs', 'utf8');
  assert.match(script, /disposableDatabaseUrl\(\)/);
  assert.match(script, /Upgrade harness requires an empty database/);
  assert.match(script, /pg_blocking_pids/);
  assert.doesNotMatch(script, /dotenv|TRUNCATE|DROP DATABASE|DISABLE TRIGGER/);
});

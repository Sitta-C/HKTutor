import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const schemaPath = 'apps/api/prisma/schema.prisma';
const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_add_booking_foundation';
const expiryMigrationSuffix = '_add_expired_booking_status';

async function readBookingMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'S1-T23 migration must exist exactly once');

  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

async function readBookingExpiryMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(expiryMigrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'Booking expiry migration must exist exactly once');

  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

function stripSqlComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '');
}

function readBlock(source, keyword, name) {
  const match = source.match(new RegExp(`${keyword} ${name}\\s*{([\\s\\S]*?)\\n}`));
  assert.ok(match, `${keyword} ${name} must exist`);
  return match[1];
}

test('defines the S1-T23 Booking Prisma boundary', async () => {
  const schema = await fs.readFile(schemaPath, 'utf8');
  const bookingStatus = readBlock(schema, 'enum', 'BookingStatus');
  const user = readBlock(schema, 'model', 'User');
  const tutorProfile = readBlock(schema, 'model', 'TutorProfile');
  const listing = readBlock(schema, 'model', 'TeachingListing');
  const slot = readBlock(schema, 'model', 'AvailabilitySlot');
  const booking = readBlock(schema, 'model', 'Booking');

  assert.match(bookingStatus, /PENDING\s+@map\("pending"\)/);
  assert.match(bookingStatus, /CONFIRMED\s+@map\("confirmed"\)/);
  assert.match(bookingStatus, /COMPLETED\s+@map\("completed"\)/);
  assert.match(bookingStatus, /CANCELED\s+@map\("canceled"\)/);
  assert.match(bookingStatus, /EXPIRED\s+@map\("expired"\)/);
  assert.equal([...bookingStatus.matchAll(/@map\(/g)].length, 5);

  assert.match(user, /studentBookings\s+Booking\[\]\s+@relation\("BookingStudent"\)/);
  assert.match(tutorProfile, /bookings\s+Booking\[\]/);
  assert.match(listing, /bookings\s+Booking\[\]/);
  assert.match(slot, /bookings\s+Booking\[\]/);

  assert.match(booking, /id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/);
  assert.match(booking, /studentUserId\s+String\s+@db\.Uuid/);
  assert.match(booking, /tutorProfileId\s+String\s+@db\.Uuid/);
  assert.match(booking, /listingId\s+String\s+@db\.Uuid/);
  assert.match(booking, /slotId\s+String\s+@db\.Uuid/);
  assert.match(booking, /status\s+BookingStatus\s+@default\(PENDING\)/);
  assert.match(booking, /subtotalAmount\s+Decimal\s+@db\.Decimal\(10,\s*2\)/);
  assert.match(booking, /discountAmount\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(10,\s*2\)/);
  assert.match(booking, /netAmount\s+Decimal\s+@db\.Decimal\(10,\s*2\)/);
  assert.match(booking, /currency\s+String\s+@default\("THB"\)\s+@db\.Char\(3\)/);
  assert.match(booking, /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
  assert.match(booking, /updatedAt\s+DateTime\s+@updatedAt\s+@db\.Timestamptz\(3\)/);

  assert.match(
    booking,
    /student\s+User\s+@relation\("BookingStudent",\s*fields:\s*\[studentUserId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(
    booking,
    /tutorProfile\s+TutorProfile\s+@relation\(fields:\s*\[tutorProfileId\],\s*references:\s*\[userId\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(
    booking,
    /listing\s+TeachingListing\s+@relation\(fields:\s*\[listingId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
  assert.match(
    booking,
    /slot\s+AvailabilitySlot\s+@relation\(fields:\s*\[slotId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );

  assert.match(
    booking,
    /@@index\(\[studentUserId,\s*status,\s*createdAt\],\s*map:\s*"Booking_studentUserId_status_createdAt_idx"\)/,
  );
  assert.match(
    booking,
    /@@index\(\[tutorProfileId,\s*status,\s*createdAt\],\s*map:\s*"Booking_tutorProfileId_status_createdAt_idx"\)/,
  );

  assert.doesNotMatch(
    booking,
    /\b(deletedAt|paymentStatus|couponId|mockReference|paidAt|meetingUrl|attendance|attendanceMarkedAt|canceledById|cancellationReason|canceledAt)\b/,
  );
  assert.doesNotMatch(schema, /model (RescheduleRequest|Review|AuditLog|Notification)\s*{/);
  assert.doesNotMatch(slot, /\b(available|reserved|status|state)\b/i);
});

test('adds the Booking expiry status and pending cleanup index', async () => {
  const sql = await readBookingExpiryMigration();

  assert.match(sql, /ALTER TYPE "BookingStatus" ADD VALUE 'expired'/i);
  assert.match(
    sql,
    /CREATE INDEX "Booking_pending_createdAt_idx"\s+ON "Booking"\s*\("createdAt"\)\s+WHERE "status" = 'pending'/i,
  );
});

test('adds the forward-only S1-T23 database invariants', async () => {
  const sql = await readBookingMigration();

  assert.equal([...sql.matchAll(/CREATE TYPE/gi)].length, 1);
  assert.equal([...sql.matchAll(/CREATE TABLE/gi)].length, 1);
  assert.match(
    sql,
    /CREATE TYPE "BookingStatus" AS ENUM \('pending', 'confirmed', 'completed', 'canceled'\)/i,
  );
  assert.match(sql, /CREATE TABLE "Booking"/i);
  assert.match(sql, /"id"\s+UUID\s+NOT NULL/i);
  assert.match(sql, /"studentUserId"\s+UUID\s+NOT NULL/i);
  assert.match(sql, /"tutorProfileId"\s+UUID\s+NOT NULL/i);
  assert.match(sql, /"listingId"\s+UUID\s+NOT NULL/i);
  assert.match(sql, /"slotId"\s+UUID\s+NOT NULL/i);
  assert.match(sql, /"status"\s+"BookingStatus"\s+NOT NULL\s+DEFAULT 'pending'/i);
  assert.match(sql, /"subtotalAmount"\s+DECIMAL\(10,2\)\s+NOT NULL/i);
  assert.match(sql, /"discountAmount"\s+DECIMAL\(10,2\)\s+NOT NULL\s+DEFAULT 0/i);
  assert.match(sql, /"netAmount"\s+DECIMAL\(10,2\)\s+NOT NULL/i);
  assert.match(sql, /"currency"\s+CHAR\(3\)\s+NOT NULL\s+DEFAULT 'THB'/i);
  assert.match(sql, /"createdAt"\s+TIMESTAMPTZ\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/i);
  assert.match(sql, /"updatedAt"\s+TIMESTAMPTZ\(3\)\s+NOT NULL/i);

  assert.match(sql, /CONSTRAINT "Booking_amounts_nonnegative_check"\s+CHECK\s*\(/i);
  assert.match(
    sql,
    /CONSTRAINT "Booking_amount_balance_check"\s+CHECK\s*\(\s*"netAmount"\s*=\s*"subtotalAmount"\s*-\s*"discountAmount"\s*\)/i,
  );
  assert.match(
    sql,
    /CONSTRAINT "Booking_currency_check"\s+CHECK\s*\(\s*"currency"\s*=\s*'THB'\s*\)/i,
  );

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "Booking_active_slot_key"\s+ON "Booking"\("slotId"\)\s+WHERE "status" IN \('pending', 'confirmed'\)/i,
  );
  assert.match(
    sql,
    /CREATE INDEX "Booking_studentUserId_status_createdAt_idx"\s+ON "Booking"\("studentUserId", "status", "createdAt"\)/i,
  );
  assert.match(
    sql,
    /CREATE INDEX "Booking_tutorProfileId_status_createdAt_idx"\s+ON "Booking"\("tutorProfileId", "status", "createdAt"\)/i,
  );

  for (const [column, table, target] of [
    ['studentUserId', 'User', 'id'],
    ['tutorProfileId', 'TutorProfile', 'userId'],
    ['listingId', 'TeachingListing', 'id'],
    ['slotId', 'AvailabilitySlot', 'id'],
  ]) {
    assert.match(
      sql,
      new RegExp(
        `FOREIGN KEY \\("${column}"\\)[\\s\\S]*?REFERENCES "${table}"\\("${target}"\\)[\\s\\S]*?ON DELETE RESTRICT ON UPDATE CASCADE`,
        'i',
      ),
    );
  }

  assert.match(
    sql,
    /CREATE FUNCTION "guard_active_booking_slot"\(\)[\s\S]*?IF NOT FOUND THEN[\s\S]*?RETURN NEW[\s\S]*?Booking_active_slot_not_deleted_check/i,
  );
  assert.match(sql, /IF slot_deleted_at IS NOT NULL THEN/i);
  assert.match(
    sql,
    /CREATE TRIGGER "Booking_active_slot_not_deleted_trg"[\s\S]*?BEFORE INSERT OR UPDATE OF "slotId", "status" ON "Booking"[\s\S]*?WHEN \(NEW\."status" IN \('pending', 'confirmed'\)\)/i,
  );
  assert.match(sql, /EXECUTE FUNCTION "guard_active_booking_slot"\(\)/i);
  assert.match(
    sql,
    /CREATE FUNCTION "guard_availability_slot_active_booking_delete"\(\)[\s\S]*?FROM "Booking"[\s\S]*?"slotId" = OLD\."id"[\s\S]*?"status" IN \('pending', 'confirmed'\)[\s\S]*?AvailabilitySlot_active_booking_delete_check/i,
  );
  assert.match(
    sql,
    /CREATE TRIGGER "AvailabilitySlot_active_booking_delete_trg"[\s\S]*?BEFORE UPDATE OF "deletedAt" ON "AvailabilitySlot"[\s\S]*?WHEN \(OLD\."deletedAt" IS NULL AND NEW\."deletedAt" IS NOT NULL\)/i,
  );
  assert.match(sql, /EXECUTE FUNCTION "guard_availability_slot_active_booking_delete"\(\)/i);
  assert.equal([...sql.matchAll(/ERRCODE\s*=\s*'23514'/gi)].length, 2);

  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(
    sql,
    /\b(paymentStatus|couponId|mockReference|meetingUrl|attendance|cancellationReason)\b/i,
  );
});

test('explicitly rejects PostgreSQL numeric NaN Booking amounts', async () => {
  const sql = stripSqlComments(await readBookingMigration());
  const match = sql.match(
    /CONSTRAINT "Booking_amounts_nonnegative_check"\s+CHECK\s*\(([\s\S]*?)\)\s*,\s*CONSTRAINT "Booking_amount_balance_check"/i,
  );

  assert.ok(match, 'Booking_amounts_nonnegative_check must retain its stable name');

  for (const column of ['subtotalAmount', 'discountAmount', 'netAmount']) {
    assert.match(
      match[1],
      new RegExp(`"${column}"\\s*<>\\s*'NaN'::numeric`, 'i'),
      `${column} must explicitly reject PostgreSQL numeric NaN`,
    );
    assert.match(match[1], new RegExp(`"${column}"\\s*>=\\s*0`, 'i'));
  }
});

test('serializes the active Booking guard with an actual slot-row update', async () => {
  const sql = stripSqlComments(await readBookingMigration());
  const match = sql.match(
    /CREATE FUNCTION "guard_active_booking_slot"\(\)\s*RETURNS TRIGGER AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql;/i,
  );

  assert.ok(match, 'guard_active_booking_slot must retain its stable function name');
  assert.match(
    match[1],
    /UPDATE "AvailabilitySlot"\s+SET "id"\s*=\s*"id"\s+WHERE "id"\s*=\s*NEW\."slotId"\s+RETURNING "deletedAt"\s+INTO slot_deleted_at\s*;/i,
    'the guard must execute a no-op row update and return deletedAt',
  );
  assert.doesNotMatch(match[1], /\bSELECT\b[\s\S]*?\bFOR UPDATE\b/i);
  assert.match(match[1], /IF NOT FOUND THEN\s+RETURN NEW\s*;/i);
});

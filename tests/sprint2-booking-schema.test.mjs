import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const schemaPath = 'apps/api/prisma/schema.prisma';
const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_add_sprint2_booking_fields';

function readBlock(source, keyword, name) {
  const match = source.match(new RegExp(`${keyword} ${name}\\s*{([\\s\\S]*?)\\n}`));
  assert.ok(match, `${keyword} ${name} must exist`);
  return match[1];
}

async function readMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
    .map((entry) => entry.name);

  assert.equal(migrations.length, 1, 'S2-DB01 migration must exist exactly once');
  return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
}

test('defines the S2-DB01 Booking Prisma boundary', async () => {
  const schema = await fs.readFile(schemaPath, 'utf8');
  const paymentStatus = readBlock(schema, 'enum', 'PaymentStatus');
  const attendanceStatus = readBlock(schema, 'enum', 'AttendanceStatus');
  const user = readBlock(schema, 'model', 'User');
  const booking = readBlock(schema, 'model', 'Booking');

  assert.match(paymentStatus, /UNPAID\s+@map\("unpaid"\)/);
  assert.match(paymentStatus, /PAID\s+@map\("paid"\)/);
  assert.equal([...paymentStatus.matchAll(/@map\(/g)].length, 2);

  assert.match(attendanceStatus, /ATTENDED\s+@map\("attended"\)/);
  assert.match(attendanceStatus, /ABSENT\s+@map\("absent"\)/);
  assert.equal([...attendanceStatus.matchAll(/@map\(/g)].length, 2);

  assert.match(user, /canceledBookings\s+Booking\[\]\s+@relation\("BookingCanceledBy"\)/);
  assert.match(booking, /paymentStatus\s+PaymentStatus\s+@default\(UNPAID\)/);
  assert.match(booking, /mockReference\s+String\?\s+@unique/);
  assert.match(booking, /paidAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  assert.match(booking, /meetingUrl\s+String\?/);
  assert.match(booking, /attendance\s+AttendanceStatus\?/);
  assert.match(booking, /attendanceMarkedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  assert.match(booking, /canceledById\s+String\?\s+@db\.Uuid/);
  assert.match(booking, /cancellationReason\s+String\?/);
  assert.match(booking, /canceledAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
  assert.match(
    booking,
    /canceledBy\s+User\?\s+@relation\("BookingCanceledBy",\s*fields:\s*\[canceledById\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
  );
});

test('adds the forward-only S2-DB01 Booking migration and constraints', async () => {
  const sql = await readMigration();

  assert.match(sql, /CREATE TYPE "PaymentStatus" AS ENUM \('unpaid', 'paid'\)/i);
  assert.match(sql, /CREATE TYPE "AttendanceStatus" AS ENUM \('attended', 'absent'\)/i);

  for (const column of [
    'paymentStatus',
    'mockReference',
    'paidAt',
    'meetingUrl',
    'attendance',
    'attendanceMarkedAt',
    'canceledById',
    'cancellationReason',
    'canceledAt',
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN "${column}"`, 'i'));
  }

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "Booking_mockReference_key"\s+ON "Booking"\("mockReference"\)/i,
  );
  assert.match(
    sql,
    /FOREIGN KEY \("canceledById"\) REFERENCES "User"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/i,
  );

  for (const constraint of [
    'Booking_payment_fields_check',
    'Booking_paid_status_check',
    'Booking_cancellation_fields_check',
    'Booking_meeting_url_https_check',
    'Booking_attendance_fields_check',
  ]) {
    assert.match(sql, new RegExp(`CONSTRAINT "${constraint}"\\s+CHECK`, 'i'));
  }

  assert.match(
    sql,
    /"paymentStatus" = 'unpaid'[\s\S]*?"mockReference" IS NULL[\s\S]*?"paidAt" IS NULL/i,
  );
  assert.match(
    sql,
    /"paymentStatus" = 'paid'[\s\S]*?"mockReference" IS NOT NULL[\s\S]*?"paidAt" IS NOT NULL/i,
  );
  assert.match(sql, /"status" = 'canceled'[\s\S]*?"canceledById" IS NOT NULL/i);
  assert.match(sql, /"meetingUrl" ~\* '\^https:\/\//i);
  assert.match(
    sql,
    /"attendance" IS NOT NULL[\s\S]*?"attendanceMarkedAt" IS NOT NULL[\s\S]*?"status" = 'completed'/i,
  );

  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX|FUNCTION|TRIGGER)/i);
  assert.doesNotMatch(sql, /\b(INSERT\s+INTO|UPDATE\s+"Booking"|DELETE\s+FROM)\b/i);
});

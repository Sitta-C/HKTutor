import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const schemaPath = 'apps/api/prisma/schema.prisma';

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
  assert.equal([...bookingStatus.matchAll(/@map\(/g)].length, 4);

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

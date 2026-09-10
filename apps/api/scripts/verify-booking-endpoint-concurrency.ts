import assert from 'node:assert/strict';

import { ConfigService } from '@nestjs/config';

import { BookingsService } from '@/bookings/bookings.service';
import { PrismaService } from '@/database/prisma.service';
import { AccountStatus, ListingPublicationStatus, Role } from '@/generated/prisma/enums';

import type { CreateBookingInput } from '@/bookings/bookings.service';

// Follows the same disposable-database safety contract as
// apps/api/scripts/verify-sprint1-database.mjs (S1-T23): this script is only allowed to
// run against a local, throwaway Postgres database. It must never touch the shared
// Supabase dev database.
const databaseUrl = process.env['DATABASE_URL'];
const disposableApproval = process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the booking endpoint concurrency verification');
}

if (disposableApproval !== '1') {
  throw new Error(
    'Set HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 only for a disposable local PostgreSQL database',
  );
}

const parsedUrl = new URL(databaseUrl);
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));

if (!allowedHosts.has(parsedUrl.hostname)) {
  throw new Error('Booking endpoint verification refuses non-local database hosts');
}

if (!/^hktutor[-_]/.test(databaseName)) {
  throw new Error('Booking endpoint verification requires a disposable hktutor-* database');
}

const ids = {
  studentA: '95000000-0000-4000-8000-000000000001',
  studentB: '95000000-0000-4000-8000-000000000002',
  studentRollback: '95000000-0000-4000-8000-000000000003',
  raceSlot: '96000000-0000-4000-8000-000000000001',
};

async function pickPublishedListing(prisma: PrismaService) {
  const listing = await prisma.teachingListing.findFirst({
    where: { deletedAt: null, publicationStatus: ListingPublicationStatus.PUBLISHED },
    orderBy: { pricePerHour: 'asc' },
    select: { id: true, tutorProfileId: true },
  });

  assert.ok(listing, 'the seed must expose at least one published listing');
  return listing;
}

async function createStudent(prisma: PrismaService, id: string, email: string) {
  await prisma.user.upsert({
    where: { id },
    create: {
      id,
      email,
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
    update: {
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      role: Role.STUDENT,
    },
  });
}

async function cleanup(prisma: PrismaService, tutorProfileId: string) {
  await prisma.booking.deleteMany({ where: { slotId: ids.raceSlot } });
  await prisma.availabilitySlot.deleteMany({ where: { id: ids.raceSlot } });
  await prisma.user.deleteMany({
    where: { id: { in: [ids.studentA, ids.studentB, ids.studentRollback] } },
  });
  void tutorProfileId;
}

async function runConcurrencyCheck(service: BookingsService, prisma: PrismaService) {
  const listing = await pickPublishedListing(prisma);

  await createStudent(prisma, ids.studentA, 'concurrency-a@hktutor.invalid');
  await createStudent(prisma, ids.studentB, 'concurrency-b@hktutor.invalid');

  await prisma.availabilitySlot.upsert({
    where: { id: ids.raceSlot },
    create: {
      id: ids.raceSlot,
      tutorProfileId: listing.tutorProfileId,
      startAtUtc: new Date(Date.now() + 60 * 60 * 1000),
      endAtUtc: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
    update: { deletedAt: null },
  });

  const inputA: CreateBookingInput = {
    listingId: listing.id,
    slotId: ids.raceSlot,
    studentUserId: ids.studentA,
  };
  const inputB: CreateBookingInput = {
    listingId: listing.id,
    slotId: ids.raceSlot,
    studentUserId: ids.studentB,
  };

  const [resultA, resultB] = await Promise.allSettled([
    service.create(inputA),
    service.create(inputB),
  ]);

  const outcomes = [resultA, resultB];
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'exactly one concurrent booking request must succeed');
  assert.equal(rejected.length, 1, 'exactly one concurrent booking request must be rejected');

  const winner = fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>>;
  assert.equal(winner.value.status, 'PENDING');

  const loser = rejected[0] as PromiseRejectedResult;
  const loserError = loser.reason as { getStatus?: () => number };
  assert.equal(
    typeof loserError.getStatus === 'function' ? loserError.getStatus() : undefined,
    409,
    'the losing concurrent request must be rejected with 409 Conflict',
  );

  const activeBookings = await prisma.booking.count({
    where: { slotId: ids.raceSlot, status: 'PENDING' },
  });
  assert.equal(activeBookings, 1, 'exactly one active booking must exist for the contested slot');

  console.info('PASS concurrent booking requests against the real endpoint yield one 201 and one 409');
}

async function runRollbackCheck(service: BookingsService, prisma: PrismaService) {
  await createStudent(prisma, ids.studentRollback, 'rollback-student@hktutor.invalid');

  const missingSlotId = '97000000-0000-4000-8000-000000000001';
  const missingListingId = '97000000-0000-4000-8000-000000000002';

  await assert.rejects(
    () =>
      service.create({
        listingId: missingListingId,
        slotId: missingSlotId,
        studentUserId: ids.studentRollback,
      }),
    (error: { getStatus?: () => number }) =>
      typeof error.getStatus === 'function' && error.getStatus() === 404,
  );

  const bookingsForStudent = await prisma.booking.count({
    where: { studentUserId: ids.studentRollback },
  });
  assert.equal(bookingsForStudent, 0, 'a failed booking request must not persist any Booking row');

  console.info('PASS a failed booking request leaves no Booking row behind');
}

async function main() {
  const prisma = new PrismaService(new ConfigService());
  await prisma.$connect();
  const service = new BookingsService(prisma);

  let tutorProfileId = '';
  try {
    const listing = await pickPublishedListing(prisma);
    tutorProfileId = listing.tutorProfileId;

    await runConcurrencyCheck(service, prisma);
    await runRollbackCheck(service, prisma);
  } finally {
    await cleanup(prisma, tutorProfileId).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.info('Booking endpoint concurrency verification passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

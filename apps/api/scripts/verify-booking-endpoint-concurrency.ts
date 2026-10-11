import assert from 'node:assert/strict';

import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import request from 'supertest';

import { AppModule } from '@app/app.module';
import { API_GLOBAL_PREFIX, configureApplication } from '@app/app.setup';
import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  PaymentStatus,
  Role,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtTokenService } from '@modules/auth/jwt.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

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
  paymentDuplicateSlot: '96000000-0000-4000-8000-000000000004',
  paymentSlot: '96000000-0000-4000-8000-000000000003',
  raceSlot: '96000000-0000-4000-8000-000000000001',
  rejectRollbackSlot: '96000000-0000-4000-8000-000000000002',
  studentA: '95000000-0000-4000-8000-000000000001',
  studentB: '95000000-0000-4000-8000-000000000002',
  studentPayment: '95000000-0000-4000-8000-000000000005',
  studentRejectRollback: '95000000-0000-4000-8000-000000000004',
  studentRollback: '95000000-0000-4000-8000-000000000003',
};
const studentIds = [
  ids.studentA,
  ids.studentB,
  ids.studentPayment,
  ids.studentRejectRollback,
  ids.studentRollback,
];
const slotIds = [ids.paymentDuplicateSlot, ids.paymentSlot, ids.raceSlot, ids.rejectRollbackSlot];
/** The probe trigger only fires for a cancellation carrying this reason. */
const ROLLBACK_PROBE_REASON = 'ROLLBACK_PROBE';
/** The payment probe trigger only fires for the reference it injects. */
const PAYMENT_PROBE_REFERENCE = 'DEMO-ROLLBACK-PROBE';
const PAYMENT_REFERENCE = 'DEMO-VERIFY-PAID';
const TUTOR_ACTION_SESSION_PREFIX = 'booking-tutor-action-';

/**
 * Every other actor in this script is a throwaway 95000000-* user, but the tutor acting on a
 * booking has to be the seeded owner of the listing. Its sign-in fields are snapshotted here so
 * cleanup can put the seeded account back exactly as it was.
 */
let seededTutorAccount: {
  accountStatus: AccountStatus;
  deletedAt: Date | null;
  emailVerifiedAt: Date | null;
  id: string;
} | null = null;

async function pickPublishedListing(prisma: PrismaService) {
  const listing = await prisma.teachingListing.findFirst({
    where: { deletedAt: null, publicationStatus: ListingPublicationStatus.PUBLISHED },
    orderBy: { pricePerHour: 'asc' },
    select: { id: true, tutorProfileId: true },
  });

  assert.ok(listing, 'the seed must expose at least one published listing');
  return listing;
}

async function createAuthenticatedStudent(
  prisma: PrismaService,
  jwtTokens: JwtTokenService,
  id: string,
  email: string,
  nickname: string,
): Promise<string> {
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
  await prisma.studentProfile.upsert({
    where: { userId: id },
    create: {
      userId: id,
      firstName: nickname,
      lastName: 'Concurrency Test',
      nickname,
      school: 'HKTutor Test School',
      gradeLevel: 'Grade 10',
      phone: '0800000000',
    },
    update: { nickname },
  });
  const session = await prisma.authSession.create({
    data: {
      userId: id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      refreshTokenHash: `booking-concurrency-${id}`,
    },
  });

  return jwtTokens.signAccessToken(id, session.id, Role.STUDENT);
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await dropRejectRollbackProbe(prisma);
  await dropPaymentRollbackProbe(prisma);
  await prisma.booking.deleteMany({ where: { slotId: { in: slotIds } } });
  await prisma.availabilitySlot.deleteMany({ where: { id: { in: slotIds } } });
  await prisma.studentProfile.deleteMany({ where: { userId: { in: studentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: studentIds } } });
  await prisma.authSession.deleteMany({
    where: { refreshTokenHash: { startsWith: TUTOR_ACTION_SESSION_PREFIX } },
  });

  if (seededTutorAccount) {
    const { id, ...sessionFields } = seededTutorAccount;
    await prisma.user.update({ data: sessionFields, where: { id } });
    seededTutorAccount = null;
  }
}

async function createTutorAccessToken(
  prisma: PrismaService,
  jwtTokens: JwtTokenService,
  tutorUserId: string,
): Promise<string> {
  if (!seededTutorAccount) {
    const seeded = await prisma.user.findUniqueOrThrow({
      select: { accountStatus: true, deletedAt: true, emailVerifiedAt: true },
      where: { id: tutorUserId },
    });
    seededTutorAccount = { ...seeded, id: tutorUserId };
  }

  // The authentication guard refuses a tutor whose seeded account is inactive or unverified.
  await prisma.user.update({
    data: { accountStatus: AccountStatus.ACTIVE, deletedAt: null, emailVerifiedAt: new Date() },
    where: { id: tutorUserId },
  });
  const session = await prisma.authSession.create({
    data: {
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      refreshTokenHash: `${TUTOR_ACTION_SESSION_PREFIX}${tutorUserId}`,
      userId: tutorUserId,
    },
  });

  return jwtTokens.signAccessToken(tutorUserId, session.id, Role.TUTOR);
}

/**
 * S2-T01 requires the confirm and reject transitions to be atomic against each other. Mocked unit
 * tests cannot prove that, so this runs both actions concurrently against a real database and
 * checks that the loser changed nothing at all.
 */
async function runTutorActionRaceCheck(
  prisma: PrismaService,
  jwtTokens: JwtTokenService,
  httpServer: App,
): Promise<string> {
  const pending = await prisma.booking.findFirst({
    select: { id: true, tutorProfileId: true },
    where: { slotId: ids.raceSlot, status: BookingStatus.PENDING },
  });
  assert.ok(
    pending,
    'the concurrency check must leave one pending booking for the tutor to act on',
  );

  const token = await createTutorAccessToken(prisma, jwtTokens, pending.tutorProfileId);
  const act = (action: 'confirm' | 'reject') =>
    request(httpServer)
      .post(`/${API_GLOBAL_PREFIX}/bookings/tutor/${pending.id}/${action}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  const responses = await Promise.all([act('confirm'), act('reject')]);

  assert.deepEqual(
    responses.map(({ status }) => status).sort(),
    [200, 409],
    'concurrent confirm and reject must produce one 200 and one 409',
  );

  const booking = await prisma.booking.findUniqueOrThrow({
    select: { canceledAt: true, canceledById: true, cancellationReason: true, status: true },
    where: { id: pending.id },
  });
  const activeBookings = await prisma.booking.count({
    where: {
      slotId: ids.raceSlot,
      status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
    },
  });
  const winnerBody = responses.find(({ status }) => status === 200)?.body as
    { slotStatus?: string; status?: string } | undefined;
  assert.equal(
    winnerBody?.status,
    booking.status,
    'the 200 response must report the stored status',
  );

  if (booking.status === BookingStatus.CANCELED) {
    assert.ok(
      booking.canceledAt !== null &&
        booking.canceledById !== null &&
        booking.cancellationReason !== null,
      'a canceled booking must store every cancellation field',
    );
    assert.equal(activeBookings, 0, 'rejecting must release the contested slot');
    assert.equal(winnerBody?.slotStatus, 'AVAILABLE');
  } else {
    assert.equal(booking.status, BookingStatus.CONFIRMED);
    assert.ok(
      booking.canceledAt === null &&
        booking.canceledById === null &&
        booking.cancellationReason === null,
      'the losing reject must not leave partial cancellation data behind',
    );
    assert.equal(activeBookings, 1, 'confirming must keep the slot reserved');
    assert.equal(winnerBody?.slotStatus, 'RESERVED');
  }

  process.stdout.write(
    'PASS concurrent confirm and reject yield one 200 and one 409 with no partial write\n',
  );

  const repeated = await act('reject');
  assert.equal(repeated.status, 409, 'a repeated tutor action must conflict');
  const unchanged = await prisma.booking.findUniqueOrThrow({
    select: { status: true },
    where: { id: pending.id },
  });
  assert.equal(
    unchanged.status,
    booking.status,
    'a conflicting tutor action must leave the booking untouched',
  );

  process.stdout.write('PASS a repeated tutor action is rejected with 409 and changes nothing\n');

  return token;
}

async function installRejectRollbackProbe(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "probe_reject_rollback"() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'injected failure after the cancellation write' USING ERRCODE = '23514';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "probe_reject_rollback_trg"
    AFTER UPDATE ON "Booking"
    FOR EACH ROW
    WHEN (NEW."status" = 'canceled' AND NEW."cancellationReason" = '${ROLLBACK_PROBE_REASON}')
    EXECUTE FUNCTION "probe_reject_rollback"();
  `);
}

async function dropRejectRollbackProbe(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "probe_reject_rollback_trg" ON "Booking";',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "probe_reject_rollback"();');
}

/**
 * S2-T01/API-03 requires evidence that a reject which fails *after* writing cannot leave the
 * booking half-canceled. A temporary AFTER UPDATE trigger raises once the PENDING row has already
 * become CANCELED inside the transaction, so only a real rollback can restore the row.
 */
async function runRejectRollbackCheck(
  prisma: PrismaService,
  jwtTokens: JwtTokenService,
  httpServer: App,
  tutorToken: string,
): Promise<void> {
  const listing = await pickPublishedListing(prisma);
  const studentToken = await createAuthenticatedStudent(
    prisma,
    jwtTokens,
    ids.studentRejectRollback,
    'reject-rollback@hktutor.invalid',
    'Rollback Reject',
  );

  const startAtUtc = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const endAtUtc = new Date(startAtUtc.getTime() + 60 * 60 * 1000);
  await prisma.availabilitySlot.upsert({
    where: { id: ids.rejectRollbackSlot },
    create: {
      id: ids.rejectRollbackSlot,
      tutorProfileId: listing.tutorProfileId,
      startAtUtc,
      endAtUtc,
    },
    update: { deletedAt: null, startAtUtc, endAtUtc },
  });

  const created = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ listingId: listing.id, slotId: ids.rejectRollbackSlot });
  assert.equal(created.status, 201, 'the rollback probe needs its own pending booking');
  const createdBody = created.body as { id?: string };
  const bookingId = createdBody.id;
  assert.ok(bookingId, 'the booking response must carry an id');

  await installRejectRollbackProbe(prisma);
  try {
    const rejected = await request(httpServer)
      .post(`/${API_GLOBAL_PREFIX}/bookings/tutor/${bookingId}/reject`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ reason: ROLLBACK_PROBE_REASON });

    // The injected fault is infrastructure rather than a business conflict, so Prisma does not
    // report a known conflict code and the API answers 500. What matters is that the request
    // neither succeeds nor leaks the database message.
    assert.equal(rejected.status, 500, 'a failed transition must not look like a success');
    assert.ok(
      !JSON.stringify(rejected.body).includes('injected failure'),
      'the failure response must not leak the database error text',
    );

    const booking = await prisma.booking.findUniqueOrThrow({
      select: { canceledAt: true, canceledById: true, cancellationReason: true, status: true },
      where: { id: bookingId },
    });
    assert.equal(booking.status, BookingStatus.PENDING, 'the booking must roll back to pending');
    assert.equal(booking.canceledAt, null, 'canceledAt must not survive the rollback');
    assert.equal(booking.canceledById, null, 'canceledById must not survive the rollback');
    assert.equal(
      booking.cancellationReason,
      null,
      'cancellationReason must not survive the rollback',
    );

    const activeBookings = await prisma.booking.count({
      where: {
        slotId: ids.rejectRollbackSlot,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
    });
    assert.equal(activeBookings, 1, 'the slot must stay reserved when the rejection rolls back');
  } finally {
    await dropRejectRollbackProbe(prisma);
  }

  process.stdout.write(
    'PASS a reject that fails after writing rolls back: 500 with no partial write, booking stays PENDING, slot stays reserved\n',
  );
}

async function runConcurrencyCheck(
  prisma: PrismaService,
  jwtTokens: JwtTokenService,
  httpServer: App,
): Promise<void> {
  const listing = await pickPublishedListing(prisma);
  const [tokenA, tokenB] = await Promise.all([
    createAuthenticatedStudent(
      prisma,
      jwtTokens,
      ids.studentA,
      'concurrency-a@hktutor.invalid',
      'Student A',
    ),
    createAuthenticatedStudent(
      prisma,
      jwtTokens,
      ids.studentB,
      'concurrency-b@hktutor.invalid',
      'Student B',
    ),
  ]);

  const startAtUtc = new Date(Date.now() + 60 * 60 * 1000);
  const endAtUtc = new Date(startAtUtc.getTime() + 60 * 60 * 1000);
  await prisma.availabilitySlot.upsert({
    where: { id: ids.raceSlot },
    create: {
      id: ids.raceSlot,
      tutorProfileId: listing.tutorProfileId,
      startAtUtc,
      endAtUtc,
    },
    update: { deletedAt: null, startAtUtc, endAtUtc },
  });

  const createBooking = (token: string) =>
    request(httpServer)
      .post(`/${API_GLOBAL_PREFIX}/bookings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId: listing.id, slotId: ids.raceSlot });
  const responses = await Promise.all([createBooking(tokenA), createBooking(tokenB)]);

  assert.deepEqual(
    responses.map(({ status }) => status).sort(),
    [201, 409],
    'two concurrent HTTP requests must produce one 201 and one 409',
  );
  const successfulResponse = responses.find(({ status }) => status === 201);
  const successfulBody = successfulResponse?.body as { status?: string } | undefined;
  assert.equal(successfulBody?.status, BookingStatus.PENDING);

  const activeBookings = await prisma.booking.count({
    where: {
      slotId: ids.raceSlot,
      status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
    },
  });
  assert.equal(activeBookings, 1, 'exactly one active booking must exist for the contested slot');

  process.stdout.write('PASS concurrent HTTP booking requests yield one 201 and one 409\n');
}

async function runFailedRequestCheck(
  prisma: PrismaService,
  jwtTokens: JwtTokenService,
  httpServer: App,
): Promise<void> {
  const token = await createAuthenticatedStudent(
    prisma,
    jwtTokens,
    ids.studentRollback,
    'rollback-student@hktutor.invalid',
    'Rollback Student',
  );
  const response = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      listingId: '97000000-0000-4000-8000-000000000002',
      slotId: '97000000-0000-4000-8000-000000000001',
    });

  assert.equal(response.status, 404);
  assert.equal(
    await prisma.booking.count({ where: { studentUserId: ids.studentRollback } }),
    0,
    'a failed HTTP booking request must not persist a Booking row',
  );

  process.stdout.write('PASS a failed HTTP booking request leaves no Booking row behind\n');
}

async function installPaymentRollbackProbe(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "probe_payment_rollback"() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'injected failure after the payment write' USING ERRCODE = '23514';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "probe_payment_rollback_trg"
    AFTER UPDATE ON "Booking"
    FOR EACH ROW
    WHEN (NEW."paymentStatus" = 'paid' AND NEW."mockReference" = '${PAYMENT_PROBE_REFERENCE}')
    EXECUTE FUNCTION "probe_payment_rollback"();
  `);
}

async function dropPaymentRollbackProbe(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "probe_payment_rollback_trg" ON "Booking";',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "probe_payment_rollback"();');
}

/**
 * S2-T04 requires evidence that a mock payment which fails *after* writing cannot leave the booking
 * half-paid. A temporary AFTER UPDATE trigger raises once the row has already become PAID inside the
 * transaction, so only a real rollback can restore the unpaid state. The same booking then proves a
 * duplicate reference is reported as its own conflict rather than a generic one.
 */
async function runMockPaymentChecks(
  prisma: PrismaService,
  jwtTokens: JwtTokenService,
  httpServer: App,
  tutorToken: string,
): Promise<void> {
  const listing = await pickPublishedListing(prisma);
  const studentToken = await createAuthenticatedStudent(
    prisma,
    jwtTokens,
    ids.studentPayment,
    'mock-payment@hktutor.invalid',
    'Rollback Payment',
  );

  const startAtUtc = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const endAtUtc = new Date(startAtUtc.getTime() + 60 * 60 * 1000);
  await prisma.availabilitySlot.upsert({
    where: { id: ids.paymentSlot },
    create: {
      id: ids.paymentSlot,
      tutorProfileId: listing.tutorProfileId,
      startAtUtc,
      endAtUtc,
    },
    update: { deletedAt: null, startAtUtc, endAtUtc },
  });

  const created = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ listingId: listing.id, slotId: ids.paymentSlot });
  assert.equal(created.status, 201, 'the payment probe needs its own booking');
  const createdBody = created.body as { id?: string; netAmount?: string };
  const bookingId = createdBody.id;
  const netAmount = createdBody.netAmount;
  assert.ok(bookingId, 'the booking response must carry an id');
  assert.ok(netAmount, 'the booking response must carry its net amount');

  const confirmed = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings/tutor/${bookingId}/confirm`)
    .set('Authorization', `Bearer ${tutorToken}`)
    .send({});
  assert.equal(confirmed.status, 200, 'only a confirmed booking can be paid');

  const mismatched = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings/me/${bookingId}/mock-payment`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ amount: '0.01', reference: 'DEMO-MISMATCH' });
  assert.equal(mismatched.status, 400, 'a stale amount must be rejected before any write');
  assert.equal(
    (mismatched.body as { code?: string }).code,
    'BOOKING_PAYMENT_AMOUNT_MISMATCH',
    'the mismatch must carry its own code',
  );

  await installPaymentRollbackProbe(prisma);
  try {
    const failed = await request(httpServer)
      .post(`/${API_GLOBAL_PREFIX}/bookings/me/${bookingId}/mock-payment`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ amount: netAmount, reference: PAYMENT_PROBE_REFERENCE });

    // The injected fault is infrastructure rather than a business conflict, so Prisma reports no
    // known conflict code and the API answers 500. What matters is that nothing was persisted.
    assert.equal(failed.status, 500, 'a failed payment must not look like a success');
    assert.ok(
      !JSON.stringify(failed.body).includes('injected failure'),
      'the failure response must not leak the database error text',
    );

    const booking = await prisma.booking.findUniqueOrThrow({
      select: { mockReference: true, paidAt: true, paymentStatus: true, status: true },
      where: { id: bookingId },
    });
    assert.equal(booking.paymentStatus, PaymentStatus.UNPAID, 'the payment must roll back');
    assert.equal(booking.paidAt, null, 'paidAt must not survive the rollback');
    assert.equal(booking.mockReference, null, 'mockReference must not survive the rollback');
    assert.equal(
      booking.status,
      BookingStatus.CONFIRMED,
      'a failed payment must not disturb the booking status',
    );
  } finally {
    await dropPaymentRollbackProbe(prisma);
  }

  process.stdout.write(
    'PASS a mock payment that fails after writing rolls back: 500 with no partial write, booking stays CONFIRMED and UNPAID\n',
  );

  const paid = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings/me/${bookingId}/mock-payment`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ amount: netAmount, reference: PAYMENT_REFERENCE });
  assert.equal(paid.status, 200, 'the retried payment must succeed after the rollback');
  assert.equal((paid.body as { paymentStatus?: string }).paymentStatus, 'PAID');

  const repeated = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings/me/${bookingId}/mock-payment`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ amount: netAmount, reference: `${PAYMENT_REFERENCE}-2` });
  assert.equal(repeated.status, 409, 'a paid booking cannot be paid again');
  assert.equal((repeated.body as { code?: string }).code, 'BOOKING_ALREADY_PAID');

  process.stdout.write(
    'PASS a confirmed booking is paid exactly once and reports PAID with paidAt\n',
  );

  // A second booking reusing the stored reference proves the unique index surfaces as its own code.
  const secondSlotStart = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await prisma.availabilitySlot.upsert({
    where: { id: ids.paymentDuplicateSlot },
    create: {
      id: ids.paymentDuplicateSlot,
      tutorProfileId: listing.tutorProfileId,
      startAtUtc: secondSlotStart,
      endAtUtc: new Date(secondSlotStart.getTime() + 60 * 60 * 1000),
    },
    update: {
      deletedAt: null,
      startAtUtc: secondSlotStart,
      endAtUtc: new Date(secondSlotStart.getTime() + 60 * 60 * 1000),
    },
  });

  const secondBooking = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ listingId: listing.id, slotId: ids.paymentDuplicateSlot });
  assert.equal(secondBooking.status, 201, 'the duplicate-reference check needs a second booking');
  const secondId = (secondBooking.body as { id?: string }).id;
  assert.ok(secondId, 'the second booking response must carry an id');

  const secondConfirmed = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings/tutor/${secondId}/confirm`)
    .set('Authorization', `Bearer ${tutorToken}`)
    .send({});
  assert.equal(secondConfirmed.status, 200, 'the second booking has to be confirmed first');

  const duplicate = await request(httpServer)
    .post(`/${API_GLOBAL_PREFIX}/bookings/me/${secondId}/mock-payment`)
    .set('Authorization', `Bearer ${studentToken}`)
    .send({ amount: netAmount, reference: PAYMENT_REFERENCE });
  assert.equal(duplicate.status, 409, 'a reused reference must conflict');
  assert.equal(
    (duplicate.body as { code?: string }).code,
    'MOCK_REFERENCE_TAKEN',
    'a reused reference must report its own code, not a generic payment conflict',
  );

  const untouched = await prisma.booking.findUniqueOrThrow({
    select: { mockReference: true, paidAt: true, paymentStatus: true },
    where: { id: secondId },
  });
  assert.equal(untouched.paymentStatus, PaymentStatus.UNPAID, 'the rejected booking stays unpaid');
  assert.equal(untouched.paidAt, null, 'the rejected booking keeps a null paidAt');
  assert.equal(untouched.mockReference, null, 'the rejected booking keeps a null reference');

  process.stdout.write(
    'PASS a reused payment reference answers 409 MOCK_REFERENCE_TAKEN and persists nothing\n',
  );
}

async function main(): Promise<void> {
  const app = await NestFactory.create<INestApplication<App>>(AppModule, {
    abortOnError: false,
    logger: false,
  });
  configureApplication(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const jwtTokens = app.get(JwtTokenService);
  const httpServer = app.getHttpServer();

  try {
    await cleanup(prisma);
    await runConcurrencyCheck(prisma, jwtTokens, httpServer);
    const tutorToken = await runTutorActionRaceCheck(prisma, jwtTokens, httpServer);
    await runRejectRollbackCheck(prisma, jwtTokens, httpServer, tutorToken);
    await runMockPaymentChecks(prisma, jwtTokens, httpServer, tutorToken);
    await runFailedRequestCheck(prisma, jwtTokens, httpServer);
  } finally {
    await cleanup(prisma).catch(() => undefined);
    await app.close();
  }

  process.stdout.write('Booking endpoint concurrency verification passed\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

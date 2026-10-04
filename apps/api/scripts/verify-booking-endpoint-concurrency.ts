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
  raceSlot: '96000000-0000-4000-8000-000000000001',
  studentA: '95000000-0000-4000-8000-000000000001',
  studentB: '95000000-0000-4000-8000-000000000002',
  studentRollback: '95000000-0000-4000-8000-000000000003',
};
const studentIds = [ids.studentA, ids.studentB, ids.studentRollback];
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
  await prisma.booking.deleteMany({ where: { slotId: ids.raceSlot } });
  await prisma.availabilitySlot.deleteMany({ where: { id: ids.raceSlot } });
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
  const seeded = await prisma.user.findUniqueOrThrow({
    select: { accountStatus: true, deletedAt: true, emailVerifiedAt: true },
    where: { id: tutorUserId },
  });
  seededTutorAccount = { ...seeded, id: tutorUserId };

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
): Promise<void> {
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
    await runTutorActionRaceCheck(prisma, jwtTokens, httpServer);
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

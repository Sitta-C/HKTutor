import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import { disposableDatabaseUrl } from '@config/disposable-database-url';
import { Prisma } from '@generated/prisma/client';
import {
  AttendanceStatus,
  BookingStatus,
  ListingPublicationStatus,
  PaymentStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { runSeed } from '@infrastructure/database/seed';
import { SPRINT3_FIXTURE_NOW, SPRINT3_IDS } from '@infrastructure/database/seed/sprint3-fixtures';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { ReportsController } from '@modules/reports/reports.controller';
import { REPORT_CURRENCY } from '@modules/reports/reports.dto';
import { ReportsService } from '@modules/reports/reports.service';

import type { TutorReportResponseDto } from '@modules/reports/reports.dto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * S3-T11: proves the S3-T09 tutor report against real PostgreSQL rows through the real
 * ReportsController, JwtAuthGuard, RolesGuard, consent check and global validation pipe. The
 * S3-T09 Jest suites replace Prisma with mocks; this runner is the database-backed counterpart.
 */
const DATABASE_NAME = 'hktutor_s3_t11_test';
const ROUTE = '/api/v1/reports/tutor/me';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function disposableTutorReportDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return disposableDatabaseUrl(env, DATABASE_NAME);
}

export interface ReportLedgerRow {
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  netAmount: string;
}

/**
 * Independent row-by-row oracle for the published report contract. It deliberately does not share
 * code with ReportsService (which aggregates grouped rows), so a defect in either one shows up as
 * a mismatch instead of being repeated on both sides of the comparison.
 */
export function expectedTutorReport(rows: readonly ReportLedgerRow[]): TutorReportResponseDto {
  const statusCounts = { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, EXPIRED: 0 };
  let revenue = new Prisma.Decimal(0);
  for (const row of rows) {
    statusCounts[row.status] += 1;
    if (row.status === BookingStatus.COMPLETED && row.paymentStatus === PaymentStatus.PAID) {
      revenue = revenue.plus(row.netAmount);
    }
  }
  const finalized = statusCounts.COMPLETED + statusCounts.CANCELED;
  return {
    totalBookings: rows.length,
    statusCounts,
    revenue: { amount: revenue.toFixed(2), currency: REPORT_CURRENCY },
    completionRate: {
      completed: statusCounts.COMPLETED,
      finalized,
      percent:
        finalized === 0
          ? null
          : new Prisma.Decimal(statusCounts.COMPLETED)
              .times(100)
              .dividedBy(finalized)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
              .toNumber(),
    },
  };
}

interface Actor {
  id: string;
  sessionId: string;
  token: string;
}

interface ExtraBooking {
  status: BookingStatus;
  paid?: boolean;
  net: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function verify(): Promise<void> {
  const databaseUrl = disposableTutorReportDatabaseUrl(process.env);
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_ACCESS_TTL_SECONDS: '900',
    JWT_AUDIENCE: 's3-t11-qa',
    JWT_ISSUER: 's3-t11-qa',
  });
  const auth = new AuthConfigService(config);
  const tokens = new JwtTokenService(auth);
  const prisma = new PrismaService(config);
  let app: INestApplication<App> | undefined;
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [ReportsController over HTTP + PostgreSQL] ${label}\n`);
  };

  try {
    const target = await prisma.$queryRaw<{ database: string; schema: string }[]>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [{ database: DATABASE_NAME, schema: 'public' }], 'Unexpected target');
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    assert.deepEqual(
      committed.filter((name) => !applied.some((row) => row.migration_name === name)),
      [],
      'Apply all migrations first',
    );
    assert.equal(await prisma.user.count(), 0, 'Use a new empty disposable database');

    // runSeed needs the three operational accounts; random throwaway values never leave this run.
    const password = randomBytes(24).toString('hex');
    Object.assign(process.env, {
      SEED_ADMIN_EMAIL: 'admin@s3t11-runner.invalid',
      SEED_ADMIN_PASSWORD: password,
      SEED_TUTOR_EMAIL: 'tutor@s3t11-runner.invalid',
      SEED_TUTOR_PASSWORD: password,
      SEED_STUDENT_EMAIL: 'student@s3t11-runner.invalid',
      SEED_STUDENT_PASSWORD: password,
    });
    await runSeed(prisma, SPRINT3_FIXTURE_NOW);

    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        ReportsService,
        JwtAuthGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: tokens },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const http = request(app.getHttpServer());

    async function login(userId: string, role: Role): Promise<Actor> {
      const session = await prisma.authSession.create({
        data: {
          userId,
          expiresAt: new Date(Date.now() + 15 * 60_000),
          refreshTokenHash: randomBytes(32).toString('hex'),
        },
      });
      return {
        id: userId,
        sessionId: session.id,
        token: tokens.signAccessToken(userId, session.id, role),
      };
    }

    async function createUser(role: Role): Promise<string> {
      const id = randomUUID();
      await prisma.user.create({
        data: {
          id,
          role,
          email: `${id}@s3t11.hktutor.invalid`,
          emailVerifiedAt: SPRINT3_FIXTURE_NOW,
          consentAcceptedAt: SPRINT3_FIXTURE_NOW,
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        },
      });
      return id;
    }

    /** Verifier-only tutor with one published listing; bookings use the DB04 subject and student. */
    async function createTutor(label: string): Promise<{ tutorId: string; listingId: string }> {
      const tutorId = await createUser(Role.TUTOR);
      await prisma.tutorProfile.create({
        data: {
          userId: tutorId,
          displayName: `S3-T11 ${label}`,
          bio: 'Synthetic S3-T11 report fixture.',
          experienceYears: 1,
          verificationStatus: TutorVerificationStatus.VERIFIED,
        },
      });
      const listing = await prisma.teachingListing.create({
        data: {
          tutorProfileId: tutorId,
          subjectId: SPRINT3_IDS.subject,
          gradeLevelId: SPRINT3_IDS.grade,
          pricePerHour: '450.00',
          description: `Synthetic S3-T11 ${label} listing`,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          publishedAt: SPRINT3_FIXTURE_NOW,
        },
      });
      return { tutorId, listingId: listing.id };
    }

    let slotOffset = 0;
    async function addBookings(
      owner: { tutorId: string; listingId: string },
      rows: readonly ExtraBooking[],
    ): Promise<void> {
      for (const row of rows) {
        slotOffset += 1;
        const startAtUtc = new Date(SPRINT3_FIXTURE_NOW.getTime() - (400 + slotOffset) * DAY);
        const slot = await prisma.availabilitySlot.create({
          data: {
            tutorProfileId: owner.tutorId,
            startAtUtc,
            endAtUtc: new Date(startAtUtc.getTime() + HOUR),
          },
        });
        const bookingId = randomUUID();
        await prisma.booking.create({
          data: {
            id: bookingId,
            studentUserId: SPRINT3_IDS.student,
            tutorProfileId: owner.tutorId,
            listingId: owner.listingId,
            slotId: slot.id,
            status: row.status,
            subtotalAmount: row.net,
            netAmount: row.net,
            ...(row.status === BookingStatus.CANCELED
              ? {
                  canceledAt: startAtUtc,
                  canceledById: SPRINT3_IDS.student,
                  cancellationReason: 'Synthetic S3-T11 cancellation',
                }
              : {}),
            ...(row.status === BookingStatus.COMPLETED
              ? {
                  attendance: AttendanceStatus.ATTENDED,
                  attendanceMarkedAt: new Date(startAtUtc.getTime() + 2 * HOUR),
                }
              : {}),
            ...(row.paid
              ? {
                  paymentStatus: PaymentStatus.PAID,
                  paidAt: startAtUtc,
                  mockReference: `S3-T11-${bookingId}`,
                }
              : {}),
          },
        });
      }
    }

    async function ledger(tutorId: string): Promise<ReportLedgerRow[]> {
      return prisma.$queryRaw<ReportLedgerRow[]>`
        SELECT upper(status::text) AS status, upper("paymentStatus"::text) AS "paymentStatus",
          "netAmount"::text AS "netAmount"
        FROM "Booking" WHERE "tutorProfileId" = ${tutorId}::uuid
      `;
    }

    async function report(actor: Actor): Promise<TutorReportResponseDto> {
      const response = await http.get(ROUTE).auth(actor.token, { type: 'bearer' });
      assert.equal(response.status, 200, 'report status');
      assert.equal(response.headers['cache-control'], 'no-store', 'report Cache-Control');
      return response.body as TutorReportResponseDto;
    }

    async function expectError(
      pending: request.Test,
      status: number,
      code: string,
      label: string,
    ): Promise<void> {
      const response = await pending;
      const body: unknown = response.body;
      assert.equal(response.status, status, `${label}: status`);
      assert.ok(isRecord(body) && body['code'] === code, `${label}: error code`);
    }

    // The ledger snapshot hashes every booking/payment column so read-only behavior is provable.
    const bookingDigest = async (): Promise<string> => {
      const rows = await prisma.$queryRaw<{ snapshot: unknown }[]>`
        SELECT jsonb_agg(to_jsonb(b) ORDER BY id) AS snapshot FROM "Booking" b
      `;
      return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    };

    // 1. The S3-DB04 905 THB ledger, including the 10% WELCOME10 discount on report-1.
    const tutor905 = await login(SPRINT3_IDS.tutors.report905, Role.TUTOR);
    const expected905: TutorReportResponseDto = {
      totalBookings: 12,
      statusCounts: { PENDING: 3, CONFIRMED: 1, COMPLETED: 6, CANCELED: 2, EXPIRED: 0 },
      revenue: { amount: '905.00', currency: 'THB' },
      completionRate: { completed: 6, finalized: 8, percent: 75 },
    };
    const rows905 = await ledger(tutor905.id);
    assert.deepEqual(expectedTutorReport(rows905), expected905, 'oracle disagrees with fixture');
    assert.deepEqual(await report(tutor905), expected905);
    pass('DB04 ledger returns 12 total, 3/1/6/2/0, 905.00 THB and 6/(6+2)=75% (oracle agrees)');

    const [money] = await prisma.$queryRaw<
      { paidCompletedNet: string; paidCompletedSubtotal: string; allNet: string }[]
    >`
      SELECT
        sum("netAmount") FILTER (WHERE status = 'completed' AND "paymentStatus" = 'paid')::text
          AS "paidCompletedNet",
        sum("subtotalAmount") FILTER (WHERE status = 'completed' AND "paymentStatus" = 'paid')::text
          AS "paidCompletedSubtotal",
        sum("netAmount")::text AS "allNet"
      FROM "Booking" WHERE "tutorProfileId" = ${tutor905.id}::uuid
    `;
    assert.deepEqual(money, {
      paidCompletedNet: '905.00',
      paidCompletedSubtotal: '950.00',
      allNet: '5405.00',
    });
    pass(
      'revenue is discounted net 405.00 + 500.00, not subtotal 950.00 nor the 5405.00 all-status total',
    );

    // 2. Empty and unfinalized ledgers return zero revenue and a null (N/A) completion rate.
    const emptyTutor = await login(SPRINT3_IDS.tutors.reportEmpty, Role.TUTOR);
    const zero = { PENDING: 0, CONFIRMED: 0, COMPLETED: 0, CANCELED: 0, EXPIRED: 0 };
    assert.deepEqual(await report(emptyTutor), {
      totalBookings: 0,
      statusCounts: zero,
      revenue: { amount: '0.00', currency: 'THB' },
      completionRate: { completed: 0, finalized: 0, percent: null },
    });
    for (const [group, status] of [
      ['reportExpired', 'EXPIRED'],
      ['reportUnfinalized', 'CONFIRMED'],
    ] as const) {
      const actor = await login(SPRINT3_IDS.tutors[group], Role.TUTOR);
      assert.deepEqual(await report(actor), {
        totalBookings: 1,
        statusCounts: { ...zero, [status]: 1 },
        revenue: { amount: '0.00', currency: 'THB' },
        completionRate: { completed: 0, finalized: 0, percent: null },
      });
    }
    pass('empty, expired-only and confirmed-only ledgers return 0.00 THB and null percent');

    // 3. HALF_UP rounding on real counts: 1/32 = 3.125% is the case that separates HALF_UP (3.13)
    // from banker's rounding (3.12); 2/3 and 1/3 cover repeating decimals.
    const rateCases = [
      { label: '1 of 32', completed: 1, canceled: 31, percent: 3.13 },
      { label: '2 of 3', completed: 2, canceled: 1, percent: 66.67 },
      { label: '1 of 3', completed: 1, canceled: 2, percent: 33.33 },
    ];
    for (const rate of rateCases) {
      const owner = await createTutor(rate.label);
      await addBookings(owner, [
        ...Array.from({ length: rate.completed }, () => ({
          status: BookingStatus.COMPLETED,
          paid: true,
          net: '450.00',
        })),
        ...Array.from({ length: rate.canceled }, () => ({
          status: BookingStatus.CANCELED,
          net: '450.00',
        })),
      ]);
      const actor = await login(owner.tutorId, Role.TUTOR);
      const body = await report(actor);
      assert.deepEqual(body.completionRate, {
        completed: rate.completed,
        finalized: rate.completed + rate.canceled,
        percent: rate.percent,
      });
      assert.deepEqual(body, expectedTutorReport(await ledger(owner.tutorId)));
    }
    pass('completion rate rounds HALF_UP to 3.13, 66.67 and 33.33 on PostgreSQL ledgers');

    // 4. Revenue exclusions with sub-baht amounts that binary floating point would misreport.
    const mixed = await createTutor('revenue exclusions');
    await addBookings(mixed, [
      { status: BookingStatus.COMPLETED, paid: true, net: '0.10' },
      { status: BookingStatus.COMPLETED, paid: true, net: '0.20' },
      { status: BookingStatus.COMPLETED, paid: true, net: '333.33' },
      { status: BookingStatus.COMPLETED, net: '999.99' },
      { status: BookingStatus.CONFIRMED, paid: true, net: '777.77' },
      { status: BookingStatus.CANCELED, net: '888.88' },
      { status: BookingStatus.EXPIRED, net: '111.11' },
      { status: BookingStatus.PENDING, net: '222.22' },
    ]);
    const mixedActor = await login(mixed.tutorId, Role.TUTOR);
    const mixedReport = await report(mixedActor);
    assert.deepEqual(mixedReport, {
      totalBookings: 8,
      statusCounts: { PENDING: 1, CONFIRMED: 1, COMPLETED: 4, CANCELED: 1, EXPIRED: 1 },
      revenue: { amount: '333.63', currency: 'THB' },
      completionRate: { completed: 4, finalized: 5, percent: 80 },
    });
    assert.deepEqual(mixedReport, expectedTutorReport(await ledger(mixed.tutorId)));
    pass(
      'only PAID+COMPLETED net counts: 0.10+0.20+333.33 = 333.63 exactly; unpaid completed, paid confirmed, canceled, expired and pending excluded',
    );

    // 5. Archived/deleted listings keep their history, and new writes appear on the next read.
    await prisma.teachingListing.update({
      where: { id: mixed.listingId },
      data: {
        publicationStatus: ListingPublicationStatus.ARCHIVED,
        deletedAt: SPRINT3_FIXTURE_NOW,
      },
    });
    assert.deepEqual(await report(mixedActor), mixedReport);
    const live = await createTutor('live update');
    await addBookings(live, [{ status: BookingStatus.COMPLETED, paid: true, net: '450.00' }]);
    const liveActor = await login(live.tutorId, Role.TUTOR);
    assert.equal((await report(liveActor)).revenue.amount, '450.00');
    await addBookings(live, [
      { status: BookingStatus.COMPLETED, paid: true, net: '405.00' },
      { status: BookingStatus.CANCELED, net: '450.00' },
    ]);
    assert.deepEqual((await report(liveActor)).completionRate, {
      completed: 2,
      finalized: 3,
      percent: 66.67,
    });
    assert.equal((await report(liveActor)).revenue.amount, '855.00');
    pass(
      'archived+deleted listing history still counts; new bookings show on the next uncached read',
    );

    // 6. Authentication and authorization happen before any report query reads data.
    const student = await login(SPRINT3_IDS.student, Role.STUDENT);
    const adminId = await createUser(Role.ADMIN);
    const admin = await login(adminId, Role.ADMIN);
    const bearer = { type: 'bearer' } as const;
    await expectError(http.get(ROUTE), 401, 'UNAUTHENTICATED', 'missing token');
    const expired = sign(
      { jti: randomUUID(), sid: tutor905.sessionId, role: Role.TUTOR, type: 'access' },
      auth.accessSecret,
      { subject: tutor905.id, issuer: auth.issuer, audience: auth.audience, expiresIn: -60 },
    );
    await expectError(http.get(ROUTE).auth(expired, bearer), 401, 'UNAUTHENTICATED', 'expired');
    const forgedSecret = sign(
      { jti: randomUUID(), sid: tutor905.sessionId, role: Role.TUTOR, type: 'access' },
      randomBytes(32).toString('hex'),
      { subject: tutor905.id, issuer: auth.issuer, audience: auth.audience, expiresIn: 60 },
    );
    await expectError(
      http.get(ROUTE).auth(forgedSecret, bearer),
      401,
      'UNAUTHENTICATED',
      'wrong signing key',
    );
    const revoked = await login(tutor905.id, Role.TUTOR);
    await prisma.authSession.update({
      where: { id: revoked.sessionId },
      data: { revokedAt: new Date() },
    });
    await expectError(
      http.get(ROUTE).auth(revoked.token, bearer),
      401,
      'UNAUTHENTICATED',
      'revoked',
    );
    await expectError(http.get(ROUTE).auth(student.token, bearer), 403, 'FORBIDDEN', 'student');
    await expectError(http.get(ROUTE).auth(admin.token, bearer), 403, 'FORBIDDEN', 'admin');
    // A token whose role claim says TUTOR cannot upgrade a STUDENT account: the guard uses the
    // database role behind the session.
    const forgedRole = tokens.signAccessToken(student.id, student.sessionId, Role.TUTOR);
    await expectError(http.get(ROUTE).auth(forgedRole, bearer), 403, 'FORBIDDEN', 'forged role');
    const outdated = await createTutor('outdated consent');
    await prisma.user.update({
      where: { id: outdated.tutorId },
      data: { policyVersion: '2000-01-01' },
    });
    const outdatedActor = await login(outdated.tutorId, Role.TUTOR);
    const consent = await http.get(ROUTE).auth(outdatedActor.token, bearer);
    assert.equal(consent.status, 403);
    assert.ok(
      isRecord(consent.body) &&
        consent.body['message'] === 'Accept the current privacy notice to continue.',
      'outdated consent message',
    );
    pass(
      '401 missing/expired/wrong-key/revoked; 403 student, admin, forged TUTOR claim and outdated consent',
    );

    // 7. Ownership: the tutor is always the authenticated user; another tutor ID is never accepted.
    await expectError(
      http.get(ROUTE).query({ tutorId: tutor905.id }).auth(emptyTutor.token, bearer),
      400,
      'VALIDATION_FAILED',
      'tutorId query',
    );
    await expectError(
      http.get(ROUTE).send({ tutorId: tutor905.id }).auth(emptyTutor.token, bearer),
      400,
      'VALIDATION_FAILED',
      'tutorId body',
    );
    assert.equal((await report(emptyTutor)).totalBookings, 0);
    pass("another tutor's ID in query or body is rejected 400 and never widens the report");

    // 8. Interleaved concurrent requests each get only their own tutor's snapshot.
    const expectations: [Actor, TutorReportResponseDto][] = [
      [tutor905, expected905],
      [emptyTutor, await report(emptyTutor)],
      [mixedActor, mixedReport],
      [liveActor, await report(liveActor)],
    ];
    const before = await bookingDigest();
    const results = await Promise.all(
      Array.from({ length: 24 }, async (_, index) => {
        const pair = expectations[index % expectations.length];
        assert.ok(pair, 'concurrent expectation');
        const [actor, expectedReport] = pair;
        assert.deepEqual(await report(actor), expectedReport, `concurrent request ${index}`);
        return index;
      }),
    );
    assert.equal(results.length, 24);
    assert.equal(await bookingDigest(), before, 'report reads must not change bookings');
    pass(
      '24 interleaved concurrent reads stay isolated per tutor and leave every booking row unchanged',
    );

    process.stdout.write(`S3-T11 tutor report verification: ${passed} checks passed.\n`);
  } finally {
    try {
      await app?.close();
    } finally {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    const reason =
      error instanceof assert.AssertionError
        ? error.message
        : error instanceof Prisma.PrismaClientKnownRequestError
          ? `${error.name}/${error.code}`
          : error instanceof Error
            ? error.name
            : 'unknown';
    process.stderr.write(`S3-T11 tutor report verification failed (${reason}).\n`);
    process.exitCode = 1;
  });
}

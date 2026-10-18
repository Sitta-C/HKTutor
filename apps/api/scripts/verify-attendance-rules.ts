import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import {
  AttendanceStatus,
  BookingStatus,
  PaymentStatus,
  RescheduleRequestStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import {
  BookingRescheduleRequestsController,
  RescheduleRequestsController,
} from '@modules/reschedule-requests/reschedule-requests.controller';
import { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * S2-T37 QA: drives PUT /bookings/tutor/:bookingId/attendance through real HTTP routes, guards,
 * services and PostgreSQL. Every rejected submission must leave the booking row byte-for-byte
 * unchanged, and a repeated identical submission must succeed without a second write.
 * Only the JWT secrets are synthetic (random per run).
 */

export function disposableAttendanceDatabaseUrl(env: NodeJS.ProcessEnv): string {
  assert.equal(
    env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable opt-in required',
  );
  const value = env['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required; this runner never loads .env');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[_-].*[_-]test$/);
  assert.equal(url.search, '', 'URL options are not accepted');
  assert.equal(url.hash, '', 'URL fragments are not accepted');
  return value;
}

/** Request bodies the API must refuse with 400 before reading the booking. */
export const REJECTED_ATTENDANCE_BODIES: readonly { label: string; body: unknown }[] = [
  { label: 'lower-case attended', body: { attendance: 'attended' } },
  { label: 'lower-case absent', body: { attendance: 'absent' } },
  { label: "story example 'late-ish'", body: { attendance: 'late-ish' } },
  { label: 'LATE', body: { attendance: 'LATE' } },
  { label: 'booking status COMPLETED', body: { attendance: 'COMPLETED' } },
  { label: 'leading space', body: { attendance: ' ATTENDED' } },
  { label: 'trailing space', body: { attendance: 'ATTENDED ' } },
  { label: 'empty string', body: { attendance: '' } },
  { label: 'null', body: { attendance: null } },
  { label: 'number', body: { attendance: 1 } },
  { label: 'boolean', body: { attendance: true } },
  { label: 'array', body: { attendance: ['ATTENDED'] } },
  { label: 'object', body: { attendance: { value: 'ATTENDED' } } },
  { label: 'missing field', body: {} },
  { label: 'extra status field', body: { attendance: 'ATTENDED', status: 'CANCELED' } },
  {
    label: 'extra attendanceMarkedAt field',
    body: { attendance: 'ATTENDED', attendanceMarkedAt: '2020-01-01T00:00:00.000Z' },
  },
  { label: 'extra tutorId field', body: { attendance: 'ATTENDED', tutorId: randomUUID() } },
];

const HOUR_MS = 3_600_000;

async function verify(): Promise<void> {
  const databaseUrl = disposableAttendanceDatabaseUrl(process.env);
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomUUID(),
    JWT_REFRESH_SECRET: randomUUID(),
  });
  const prisma = new PrismaService(config);
  const ids = {
    student: randomUUID(),
    otherStudent: randomUUID(),
    tutor: randomUUID(),
    otherTutor: randomUUID(),
    admin: randomUUID(),
    subject: randomUUID(),
    grade: randomUUID(),
    listing: randomUUID(),
  };
  const users = [ids.student, ids.otherStudent, ids.tutor, ids.otherTutor, ids.admin];
  const tutors = [ids.tutor, ids.otherTutor];
  const students = [ids.student, ids.otherStudent];
  const roles: Record<string, Role> = {
    [ids.student]: Role.STUDENT,
    [ids.otherStudent]: Role.STUDENT,
    [ids.tutor]: Role.TUTOR,
    [ids.otherTutor]: Role.TUTOR,
    [ids.admin]: Role.ADMIN,
  };
  let app: INestApplication<App> | undefined;
  let futureSequence = 0;
  let pastSequence = 0;
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [HTTP + real guards/services + PostgreSQL] ${label}\n`);
  };

  try {
    await prisma.$connect();
    const target = await prisma.$queryRaw<{ database: string }[]>`
      SELECT current_database() AS database
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) },
    ]);
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const finished = new Set(applied.map((row) => row.migration_name));
    assert.deepEqual(
      committed.filter((name) => !finished.has(name)),
      [],
      'Apply all migrations first',
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [
        BookingsController,
        BookingRescheduleRequestsController,
        RescheduleRequestsController,
      ],
      providers: [
        BookingsService,
        NotificationEventsService,
        RescheduleRequestsService,
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        JwtTokenService,
        AuthConfigService,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    const server = app.getHttpServer();
    const jwt = moduleRef.get(JwtTokenService);

    await prisma.user.createMany({
      data: users.map((id) => ({
        id,
        email: `${id}@attendance.invalid`,
        role: roles[id] ?? Role.STUDENT,
        emailVerifiedAt: new Date(),
        consentAcceptedAt: new Date(),
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      })),
    });
    for (const userId of students) {
      await prisma.studentProfile.create({
        data: {
          userId,
          firstName: 'QA',
          lastName: 'Student',
          nickname: 'Learner',
          school: 'Synthetic school',
          gradeLevel: '10',
          phone: '0800000000',
        },
      });
    }
    for (const userId of tutors) {
      await prisma.tutorProfile.create({
        data: {
          userId,
          displayName: 'Synthetic tutor',
          bio: 'Attendance QA fixture',
          experienceYears: 0,
          verificationStatus: TutorVerificationStatus.VERIFIED,
        },
      });
    }
    await prisma.subject.create({
      data: { id: ids.subject, code: ids.subject, name: `Subject ${ids.subject}` },
    });
    await prisma.gradeLevel.create({
      data: { id: ids.grade, code: ids.grade, name: ids.grade, sortOrder: 1 },
    });
    await prisma.teachingListing.create({
      data: {
        id: ids.listing,
        tutorProfileId: ids.tutor,
        subjectId: ids.subject,
        gradeLevelId: ids.grade,
        pricePerHour: '450.00',
        description: 'Synthetic attendance verification course',
        publicationStatus: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    const sessions = new Map<string, string>();
    async function signedToken(userId: string): Promise<{ sessionId: string; token: string }> {
      const session = await prisma.authSession.create({
        data: {
          userId,
          expiresAt: new Date(Date.now() + HOUR_MS),
          refreshTokenHash: `attendance-${randomUUID()}`,
        },
      });
      return {
        sessionId: session.id,
        token: jwt.signAccessToken(userId, session.id, roles[userId] ?? Role.STUDENT),
      };
    }
    async function token(userId: string): Promise<string> {
      const existing = sessions.get(userId);
      if (existing) {
        return existing;
      }
      const { token: signed } = await signedToken(userId);
      sessions.set(userId, signed);
      return signed;
    }
    async function call(
      userId: string,
      method: 'get' | 'post' | 'put',
      path: string,
      body?: unknown,
    ): Promise<request.Response> {
      const pending = request(server)
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${await token(userId)}`);
      return body === undefined ? pending : pending.send(body as object);
    }
    function putAttendance(
      userId: string,
      bookingId: string,
      body: unknown,
    ): Promise<request.Response> {
      return call(userId, 'put', `/bookings/tutor/${bookingId}/attendance`, body);
    }
    function record(
      userId: string,
      bookingId: string,
      attendance: AttendanceStatus,
    ): Promise<request.Response> {
      return putAttendance(userId, bookingId, { attendance });
    }
    async function futureSlot(): Promise<string> {
      const start = Date.UTC(2099, 0, 1) + futureSequence++ * 2 * HOUR_MS;
      const slot = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: ids.tutor,
          startAtUtc: new Date(start),
          endAtUtc: new Date(start + HOUR_MS),
        },
      });
      return slot.id;
    }
    /** Creates a booking through the API and optionally confirms it as the owning tutor. */
    async function booking(confirm = true): Promise<{ bookingId: string; slotId: string }> {
      const slotId = await futureSlot();
      const created = await call(ids.student, 'post', '/bookings', {
        listingId: ids.listing,
        slotId,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const bookingId = (created.body as { id: string }).id;
      if (confirm) {
        const confirmed = await call(ids.tutor, 'post', `/bookings/tutor/${bookingId}/confirm`, {});
        assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      }
      return { bookingId, slotId };
    }
    /**
     * Simulates the passage of time by moving a slot into the past. Bookings can only be made
     * for future slots, so this is the only way to reach an ended class in a fresh database.
     * Each ended window is distinct and ends at least an hour ago, so it never overlaps another
     * ended window or the in-progress window under the per-tutor no-overlap exclusion.
     */
    async function moveSlot(slotId: string, window: 'ended' | 'in-progress'): Promise<void> {
      const now = Date.now();
      const end =
        window === 'ended' ? now - HOUR_MS - pastSequence++ * 2 * HOUR_MS : now + 30 * 60_000;
      const start = window === 'ended' ? end - HOUR_MS : now - 30 * 60_000;
      await prisma.availabilitySlot.update({
        where: { id: slotId },
        data: { startAtUtc: new Date(start), endAtUtc: new Date(end) },
      });
    }
    async function endedBooking(): Promise<string> {
      const { bookingId, slotId } = await booking();
      await moveSlot(slotId, 'ended');
      return bookingId;
    }
    async function snapshot(bookingId: string) {
      return prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: {
          attendance: true,
          attendanceMarkedAt: true,
          canceledAt: true,
          meetingUrl: true,
          paidAt: true,
          paymentStatus: true,
          slotId: true,
          status: true,
          updatedAt: true,
        },
      });
    }
    function expectCode(response: request.Response, status: number, code: string): void {
      assert.equal(response.status, status, JSON.stringify(response.body));
      assert.equal((response.body as { code?: string }).code, code, JSON.stringify(response.body));
    }
    function bodyOf(response: request.Response): {
      attendance: AttendanceStatus;
      attendanceMarkedAt: string;
      bookingId: string;
      idempotentReplay: boolean;
      status: BookingStatus;
    } {
      return response.body as ReturnType<typeof bodyOf>;
    }

    // 1. Future and in-progress classes are refused for both values, without mutation.
    const future = await booking();
    const futureBefore = await snapshot(future.bookingId);
    for (const attendance of [AttendanceStatus.ATTENDED, AttendanceStatus.ABSENT]) {
      expectCode(await record(ids.tutor, future.bookingId, attendance), 409, 'CLASS_NOT_ENDED');
    }
    await moveSlot(future.slotId, 'in-progress');
    const runningBefore = await snapshot(future.bookingId);
    assert.deepEqual(
      { ...runningBefore, updatedAt: futureBefore.updatedAt },
      futureBefore,
      'Only the slot moved',
    );
    for (const attendance of [AttendanceStatus.ATTENDED, AttendanceStatus.ABSENT]) {
      expectCode(await record(ids.tutor, future.bookingId, attendance), 409, 'CLASS_NOT_ENDED');
    }
    assert.deepEqual(await snapshot(future.bookingId), runningBefore);
    pass('future and in-progress classes return 409 CLASS_NOT_ENDED and stay confirmed');

    // 2. Pending, rejected, canceled and expired bookings are refused even after the class ends.
    const pending = await booking(false);
    await moveSlot(pending.slotId, 'ended');
    const rejected = await booking(false);
    const reject = await call(
      ids.tutor,
      'post',
      `/bookings/tutor/${rejected.bookingId}/reject`,
      {},
    );
    assert.equal(reject.status, 200, JSON.stringify(reject.body));
    await moveSlot(rejected.slotId, 'ended');
    const canceled = await booking();
    const cancel = await call(ids.student, 'post', `/bookings/${canceled.bookingId}/cancel`, {
      reason: 'QA attendance eligibility',
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    await moveSlot(canceled.slotId, 'ended');
    const expired = await booking(false);
    await moveSlot(expired.slotId, 'ended');
    // EXPIRED has no API transition yet; simulate a legacy row.
    await prisma.$executeRaw`
      UPDATE "Booking" SET "status" = 'expired' WHERE "id" = ${expired.bookingId}::uuid
    `;
    const ineligible: [string, string, BookingStatus][] = [
      ['pending', pending.bookingId, BookingStatus.PENDING],
      ['rejected', rejected.bookingId, BookingStatus.CANCELED],
      ['canceled', canceled.bookingId, BookingStatus.CANCELED],
      ['expired', expired.bookingId, BookingStatus.EXPIRED],
    ];
    for (const [label, bookingId, status] of ineligible) {
      const before = await snapshot(bookingId);
      assert.equal(before.status, status, label);
      for (const attendance of [AttendanceStatus.ATTENDED, AttendanceStatus.ABSENT]) {
        const response = await record(ids.tutor, bookingId, attendance);
        expectCode(response, 409, 'BOOKING_NOT_CONFIRMED_OR_COMPLETED');
      }
      assert.deepEqual(await snapshot(bookingId), before, `${label} booking changed`);
    }
    pass('ended pending, rejected, canceled and expired bookings return 409 and are unchanged');

    // 3. Invalid attendance values and malformed requests never reach the booking.
    const eligibleId = await endedBooking();
    const eligibleBefore = await snapshot(eligibleId);
    for (const { label, body } of REJECTED_ATTENDANCE_BODIES) {
      const response = await putAttendance(ids.tutor, eligibleId, body);
      assert.equal(response.status, 400, `${label} -> ${response.status}`);
    }
    const textBody = await request(server)
      .put(`/api/v1/bookings/tutor/${eligibleId}/attendance`)
      .set('Authorization', `Bearer ${await token(ids.tutor)}`)
      .set('Content-Type', 'text/plain')
      .send('ATTENDED');
    assert.equal(textBody.status, 400, `text/plain -> ${textBody.status}`);
    const malformedId = await record(ids.tutor, 'not-a-uuid', AttendanceStatus.ATTENDED);
    assert.equal(malformedId.status, 400);
    assert.deepEqual(await snapshot(eligibleId), eligibleBefore);
    pass(`${REJECTED_ATTENDANCE_BODIES.length + 2} invalid bodies and IDs return 400 unchanged`);

    // 4. Only the owning tutor may record; every other caller is refused without mutation.
    const revoked = await signedToken(ids.tutor);
    await prisma.authSession.update({
      where: { id: revoked.sessionId },
      data: { revokedAt: new Date() },
    });
    const wrongActors: [string, () => Promise<request.Response>, number][] = [
      ['other tutor', () => record(ids.otherTutor, eligibleId, AttendanceStatus.ATTENDED), 403],
      ['booking student', () => record(ids.student, eligibleId, AttendanceStatus.ATTENDED), 403],
      ['other student', () => record(ids.otherStudent, eligibleId, AttendanceStatus.ABSENT), 403],
      ['admin', () => record(ids.admin, eligibleId, AttendanceStatus.ATTENDED), 403],
      [
        'anonymous',
        () =>
          request(server)
            .put(`/api/v1/bookings/tutor/${eligibleId}/attendance`)
            .send({ attendance: AttendanceStatus.ATTENDED }),
        401,
      ],
      [
        'malformed bearer token',
        () =>
          request(server)
            .put(`/api/v1/bookings/tutor/${eligibleId}/attendance`)
            .set('Authorization', 'Bearer not-a-jwt')
            .send({ attendance: AttendanceStatus.ATTENDED }),
        401,
      ],
      [
        'owner with a revoked session',
        () =>
          request(server)
            .put(`/api/v1/bookings/tutor/${eligibleId}/attendance`)
            .set('Authorization', `Bearer ${revoked.token}`)
            .send({ attendance: AttendanceStatus.ATTENDED }),
        401,
      ],
    ];
    for (const [label, send, expected] of wrongActors) {
      const response = await send();
      assert.equal(response.status, expected, `${label} -> ${response.status}`);
    }
    expectCode(
      await record(ids.otherTutor, eligibleId, AttendanceStatus.ATTENDED),
      403,
      'BOOKING_NOT_OWNED',
    );
    expectCode(
      await record(ids.tutor, randomUUID(), AttendanceStatus.ATTENDED),
      404,
      'BOOKING_NOT_FOUND',
    );
    assert.deepEqual(await snapshot(eligibleId), eligibleBefore);
    pass('other tutors, students and admins get 403, bad sessions 401, unknown booking 404');

    // 5. The owner's first write completes the class; identical repeats are safe no-op replays.
    const before = Date.now();
    const first = await record(ids.tutor, eligibleId, AttendanceStatus.ATTENDED);
    const after = Date.now();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const saved = bodyOf(first);
    assert.equal(saved.idempotentReplay, false);
    assert.equal(saved.status, BookingStatus.COMPLETED);
    assert.equal(saved.attendance, AttendanceStatus.ATTENDED);
    assert.equal(saved.bookingId, eligibleId);
    const markedAt = Date.parse(saved.attendanceMarkedAt);
    assert.ok(markedAt >= before - 1 && markedAt <= after + 1, 'Timestamp is server time');
    const completed = await snapshot(eligibleId);
    assert.deepEqual(
      {
        attendance: completed.attendance,
        attendanceMarkedAt: completed.attendanceMarkedAt?.toISOString(),
        status: completed.status,
      },
      {
        attendance: AttendanceStatus.ATTENDED,
        attendanceMarkedAt: saved.attendanceMarkedAt,
        status: BookingStatus.COMPLETED,
      },
    );
    for (let replay = 0; replay < 3; replay += 1) {
      const repeat = await record(ids.tutor, eligibleId, AttendanceStatus.ATTENDED);
      assert.equal(repeat.status, 200, JSON.stringify(repeat.body));
      assert.deepEqual(bodyOf(repeat), { ...saved, idempotentReplay: true });
    }
    assert.deepEqual(await snapshot(eligibleId), completed, 'Replays must not write');
    pass('first ATTENDED completes the class; three identical repeats return 200 with no write');

    // 6. A different value after recording is refused; the original record is kept.
    const changed = await record(ids.tutor, eligibleId, AttendanceStatus.ABSENT);
    expectCode(changed, 409, 'ATTENDANCE_ALREADY_RECORDED');
    const invalidReplay = await putAttendance(ids.tutor, eligibleId, { attendance: 'attended' });
    assert.equal(invalidReplay.status, 400);
    const outsiderReplay = await record(ids.otherTutor, eligibleId, AttendanceStatus.ATTENDED);
    expectCode(outsiderReplay, 403, 'BOOKING_NOT_OWNED');
    assert.ok(
      !JSON.stringify(outsiderReplay.body).includes(saved.attendanceMarkedAt),
      'Another tutor must not learn the saved record',
    );
    assert.deepEqual(await snapshot(eligibleId), completed);

    const absentId = await endedBooking();
    const absent = await record(ids.tutor, absentId, AttendanceStatus.ABSENT);
    assert.equal(absent.status, 200, JSON.stringify(absent.body));
    const absentSaved = await snapshot(absentId);
    const absentRepeat = await record(ids.tutor, absentId, AttendanceStatus.ABSENT);
    assert.deepEqual(bodyOf(absentRepeat), { ...bodyOf(absent), idempotentReplay: true });
    expectCode(
      await record(ids.tutor, absentId, AttendanceStatus.ATTENDED),
      409,
      'ATTENDANCE_ALREADY_RECORDED',
    );
    assert.deepEqual(await snapshot(absentId), absentSaved);
    pass('changing a saved value returns 409 for both ATTENDED and ABSENT; record is kept');

    // 7. Participants read the saved record; completion closes payment and cancellation.
    for (const viewer of [ids.student, ids.tutor]) {
      const details = await call(viewer, 'get', `/bookings/${eligibleId}/class-details`);
      assert.equal(details.status, 200, JSON.stringify(details.body));
      const detail = details.body as {
        attendance: AttendanceStatus | null;
        attendanceMarkedAt: string | null;
        status: BookingStatus;
      };
      assert.deepEqual(
        [detail.status, detail.attendance, detail.attendanceMarkedAt],
        [BookingStatus.COMPLETED, AttendanceStatus.ATTENDED, saved.attendanceMarkedAt],
      );
    }
    const studentDetail = await call(ids.student, 'get', `/bookings/me/${eligibleId}`);
    assert.equal((studentDetail.body as { status: string }).status, BookingStatus.COMPLETED);
    expectCode(
      await call(ids.student, 'post', `/bookings/${eligibleId}/cancel`, { reason: 'Too late' }),
      409,
      'BOOKING_ALREADY_COMPLETED',
    );
    expectCode(
      await call(ids.student, 'post', `/bookings/me/${eligibleId}/mock-payment`, {
        amount: '450.00',
        reference: `DEMO-${randomUUID()}`,
      }),
      409,
      'BOOKING_NOT_PAYABLE',
    );
    assert.deepEqual(await snapshot(eligibleId), completed);
    pass('both participants read the saved record; cancel and late payment return 409');

    // 8. Concurrent identical submissions: exactly one first write, everyone gets the same record.
    for (let round = 0; round < 3; round += 1) {
      const raceId = await endedBooking();
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => record(ids.tutor, raceId, AttendanceStatus.ATTENDED)),
      );
      for (const response of responses) {
        assert.equal(response.status, 200, JSON.stringify(response.body));
      }
      const firstWrites = responses.filter((response) => !bodyOf(response).idempotentReplay);
      assert.equal(firstWrites.length, 1, 'Exactly one request performs the write');
      const stamps = new Set(responses.map((response) => bodyOf(response).attendanceMarkedAt));
      assert.equal(stamps.size, 1, 'Every caller sees the single saved timestamp');
      const row = await snapshot(raceId);
      assert.equal(row.attendanceMarkedAt?.toISOString(), [...stamps][0]);
    }
    pass('three rounds of 8 concurrent identical submissions: one write, one timestamp, all 200');

    // 9. Concurrent conflicting submissions: one value wins, the rest are 409 or safe replays.
    for (let round = 0; round < 3; round += 1) {
      const raceId = await endedBooking();
      const values = [AttendanceStatus.ATTENDED, AttendanceStatus.ABSENT];
      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          record(ids.tutor, raceId, values[index % 2] ?? AttendanceStatus.ATTENDED),
        ),
      );
      const row = await snapshot(raceId);
      assert.equal(row.status, BookingStatus.COMPLETED);
      for (const [index, response] of responses.entries()) {
        const sent = values[index % 2];
        if (sent === row.attendance) {
          assert.equal(response.status, 200, JSON.stringify(response.body));
          assert.equal(bodyOf(response).attendanceMarkedAt, row.attendanceMarkedAt?.toISOString());
        } else {
          expectCode(response, 409, 'ATTENDANCE_ALREADY_RECORDED');
        }
      }
      assert.equal(
        responses.filter(
          (response) => response.status === 200 && !bodyOf(response).idempotentReplay,
        ).length,
        1,
      );
    }
    pass('three rounds of 8 ATTENDED-versus-ABSENT submissions: one winner, losers 409, no 5xx');

    // 10. Attendance racing a mock payment leaves a consistent row either way.
    for (let round = 0; round < 5; round += 1) {
      const raceId = await endedBooking();
      const [attendance, payment] = await Promise.all([
        record(ids.tutor, raceId, AttendanceStatus.ATTENDED),
        call(ids.student, 'post', `/bookings/me/${raceId}/mock-payment`, {
          amount: '450.00',
          reference: `DEMO-${randomUUID()}`,
        }),
      ]);
      assert.equal(attendance.status, 200, JSON.stringify(attendance.body));
      assert.ok([200, 409].includes(payment.status), `payment -> ${payment.status}`);
      const row = await snapshot(raceId);
      assert.equal(row.status, BookingStatus.COMPLETED);
      assert.equal(
        row.paymentStatus,
        payment.status === 200 ? PaymentStatus.PAID : PaymentStatus.UNPAID,
      );
      assert.equal(row.paidAt === null, payment.status !== 200);
    }
    pass('five attendance-versus-payment races: no 5xx, payment state matches its response');

    // 11. Eligibility follows the booking's current slot after an approved reschedule.
    const moved = await booking();
    const targetSlotId = await futureSlot();
    const requested = await call(
      ids.student,
      'post',
      `/bookings/${moved.bookingId}/reschedule-requests`,
      { targetSlotId },
    );
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    const requestId = (requested.body as { requestId: string }).requestId;
    const approved = await call(ids.tutor, 'post', `/reschedule-requests/${requestId}/approve`, {});
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal((await snapshot(moved.bookingId)).slotId, targetSlotId);
    await moveSlot(moved.slotId, 'ended');
    expectCode(
      await record(ids.tutor, moved.bookingId, AttendanceStatus.ATTENDED),
      409,
      'CLASS_NOT_ENDED',
    );
    await moveSlot(targetSlotId, 'ended');
    assert.equal((await record(ids.tutor, moved.bookingId, AttendanceStatus.ATTENDED)).status, 200);
    pass('after a reschedule, the old slot ending is not enough; the new slot must end');

    // 12. A reschedule request still pending when the class ends cannot move a completed class.
    const stale = await booking();
    const staleTarget = await futureSlot();
    const staleRequest = await call(
      ids.student,
      'post',
      `/bookings/${stale.bookingId}/reschedule-requests`,
      { targetSlotId: staleTarget },
    );
    assert.equal(staleRequest.status, 201, JSON.stringify(staleRequest.body));
    const staleRequestId = (staleRequest.body as { requestId: string }).requestId;
    await moveSlot(stale.slotId, 'ended');
    assert.equal((await record(ids.tutor, stale.bookingId, AttendanceStatus.ABSENT)).status, 200);
    const completedStale = await snapshot(stale.bookingId);
    const lateApprove = await call(
      ids.tutor,
      'post',
      `/reschedule-requests/${staleRequestId}/approve`,
      {},
    );
    assert.equal(lateApprove.status, 409, JSON.stringify(lateApprove.body));
    assert.deepEqual(await snapshot(stale.bookingId), completedStale);
    const lingering = await prisma.rescheduleRequest.findUniqueOrThrow({
      where: { id: staleRequestId },
      select: { status: true },
    });
    // Recorded as a finding in tests/s2-t37-qa.md: the request is not closed automatically.
    assert.equal(lingering.status, RescheduleRequestStatus.PENDING);
    const reservedTarget = await prisma.booking.count({
      where: {
        slotId: staleTarget,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
    });
    assert.equal(reservedTarget, 0, 'The target slot stays free');
    pass('approving a stale reschedule after completion returns 409; class and target unchanged');

    process.stdout.write(`Passed ${passed} attendance checks.\n`);
  } finally {
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: users } } });
      await prisma.rescheduleRequest.deleteMany({
        where: { booking: { tutorProfileId: { in: tutors } } },
      });
      await prisma.booking.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.availabilitySlot.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.teachingListing.deleteMany({ where: { id: ids.listing } });
      await prisma.authSession.deleteMany({ where: { userId: { in: users } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: tutors } } });
      await prisma.studentProfile.deleteMany({ where: { userId: { in: students } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.subject.deleteMany({ where: { id: ids.subject } });
      await prisma.gradeLevel.deleteMany({ where: { id: ids.grade } });
    } finally {
      await app?.close();
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Unknown failure'}\n` +
        'Attendance verification failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

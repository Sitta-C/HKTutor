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
import { NotificationsController } from '@modules/notifications/notifications.controller';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { RescheduleRequestsController } from '@modules/reschedule-requests/reschedule-requests.controller';
import { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * S2-T34 QA: exercises the meeting-link write and class-details read through real HTTP routes,
 * guards, services and PostgreSQL, then sweeps every participant read surface for link leakage.
 * Only the JWT secrets are synthetic (random per run).
 */

export function disposableMeetingDatabaseUrl(env: NodeJS.ProcessEnv): string {
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

/** Inputs the API must refuse with 400 before touching the booking. */
const REJECTED_MEETING_URLS: readonly string[] = [
  'javascript:alert(1)',
  'JavaScript:alert(document.cookie)',
  ' javascript:alert(1)',
  'javascript://meet.example.com/%0Aalert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'http://meet.example.com/class',
  'HTTP://meet.example.com/class',
  'ftp://meet.example.com/class',
  'ws://meet.example.com/class',
  '//meet.example.com/class',
  'meet.example.com/class',
  'https:/meet.example.com',
  'https:meet.example.com',
  'https://',
  'https:// meet.example.com',
  ' https://meet.example.com',
  'https://meet.example.com ',
  'https://meet.example.com\n',
  'https://meet.example.com/x\njavascript:alert(1)',
  'https://meet.example.com/x\r\nSet-Cookie: a=b',
  'https://meet.example.com/ ',
  // Found by this QA pass (previously 500 or silently stored); see tests/s2-t34-qa.md.
  'https://meet.example.com/a\u0000b',
  'https://meet.example.com/a\u0001b',
  'https://meet.example.com/a b',
  'https://meet.example.com/a\tb',
  'https://meet.example.com/‮gpj.exe',
  'https://meet.google.com@evil.example/class',
  'https://user:secret@meet.example.com/class',
];

async function verify(): Promise<void> {
  const databaseUrl = disposableMeetingDatabaseUrl(process.env);
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
  let slotSequence = 0;
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
      controllers: [BookingsController, NotificationsController, RescheduleRequestsController],
      providers: [
        BookingsService,
        NotificationEventsService,
        NotificationsService,
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
        email: `${id}@meeting-link.invalid`,
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
          bio: 'Meeting link QA fixture',
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
        description: 'Synthetic meeting link verification course',
        publicationStatus: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    const sessions = new Map<string, string>();
    async function token(userId: string): Promise<string> {
      const existing = sessions.get(userId);
      if (existing) {
        return existing;
      }
      const session = await prisma.authSession.create({
        data: {
          userId,
          expiresAt: new Date(Date.now() + 3_600_000),
          refreshTokenHash: `meeting-link-${randomUUID()}`,
        },
      });
      const signed = jwt.signAccessToken(userId, session.id, roles[userId] ?? Role.STUDENT);
      sessions.set(userId, signed);
      return signed;
    }
    async function call(
      userId: string,
      method: 'get' | 'post' | 'put',
      path: string,
      body?: object,
    ): Promise<request.Response> {
      const pending = request(server)
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${await token(userId)}`);
      return body === undefined ? pending : pending.send(body);
    }
    /** Creates a booking through the API, then optionally confirms it as the owning tutor. */
    async function booking(confirm = true): Promise<string> {
      const start = Date.UTC(2099, 2, 1) + slotSequence++ * 7_200_000;
      const slot = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: ids.tutor,
          startAtUtc: new Date(start),
          endAtUtc: new Date(start + 3_600_000),
        },
      });
      const created = await call(ids.student, 'post', '/bookings', {
        listingId: ids.listing,
        slotId: slot.id,
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const bookingId = (created.body as { id: string }).id;
      if (confirm) {
        const confirmed = await call(ids.tutor, 'post', `/bookings/tutor/${bookingId}/confirm`, {});
        assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      }
      return bookingId;
    }
    function putLink(userId: string, bookingId: string, meetingUrl: unknown) {
      return call(userId, 'put', `/bookings/tutor/${bookingId}/meeting-link`, { meetingUrl });
    }
    function readClass(userId: string, bookingId: string) {
      return call(userId, 'get', `/bookings/${bookingId}/class-details`);
    }
    async function stored(bookingId: string) {
      return prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { meetingUrl: true, status: true, updatedAt: true },
      });
    }
    /** Every authenticated read a participant can make about a booking. */
    async function participantReads(bookingId: string): Promise<request.Response[]> {
      return Promise.all([
        readClass(ids.student, bookingId),
        readClass(ids.tutor, bookingId),
        call(ids.student, 'get', '/bookings/me'),
        call(ids.student, 'get', `/bookings/me/${bookingId}`),
        call(ids.tutor, 'get', '/bookings/tutor'),
        call(ids.student, 'get', `/bookings/${bookingId}/reschedule-requests/current`),
        call(ids.tutor, 'get', `/bookings/${bookingId}/reschedule-requests/current`),
        call(ids.student, 'get', '/notifications'),
        call(ids.tutor, 'get', '/notifications'),
      ]);
    }
    function assertNoLink(responses: request.Response[], url: string, where: string): void {
      responses.forEach((response, index) => {
        assert.ok(response.status < 500, `${where} read #${index}: ${response.status}`);
        assert.ok(
          !JSON.stringify(response.body).includes(url),
          `${where} read #${index} leaked the meeting link`,
        );
      });
    }

    // 1. Missing link: confirmed booking with no URL still renders class details for both sides.
    const confirmedId = await booking();
    for (const viewer of [ids.student, ids.tutor]) {
      const response = await readClass(viewer, confirmedId);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const body = response.body as {
        meetingUrl: string | null;
        status: string;
        startAt: string;
        subject: { id: string };
      };
      assert.equal(body.meetingUrl, null);
      assert.equal(body.status, BookingStatus.CONFIRMED);
      assert.equal(body.subject.id, ids.subject);
      assert.ok(!Number.isNaN(Date.parse(body.startAt)));
    }
    pass('a confirmed class without a link returns meetingUrl null with date and subject');

    // 2. URL scheme and shape rejection.
    const beforeInvalid = await stored(confirmedId);
    for (const meetingUrl of [...REJECTED_MEETING_URLS, '', null, 42, ['https://a.example']]) {
      const response = await putLink(ids.tutor, confirmedId, meetingUrl);
      assert.equal(response.status, 400, `${JSON.stringify(meetingUrl)} -> ${response.status}`);
    }
    assert.deepEqual(await stored(confirmedId), beforeInvalid);
    pass(`all ${REJECTED_MEETING_URLS.length + 4} unsafe or malformed inputs return 400 unchanged`);

    // 3. Owner write is visible to both participants.
    const link = `https://meet.example.com/${randomUUID()}`;
    const saved = await putLink(ids.tutor, confirmedId, link);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((saved.body as { meetingUrl: string }).meetingUrl, link);
    for (const viewer of [ids.student, ids.tutor]) {
      const response = await readClass(viewer, confirmedId);
      assert.equal((response.body as { meetingUrl: string }).meetingUrl, link);
    }
    const upper = `HTTPS://Meet.Example.com/${randomUUID()}`;
    assert.equal((await putLink(ids.tutor, confirmedId, upper)).status, 200);
    assert.equal((await putLink(ids.tutor, confirmedId, link)).status, 200);
    pass('the owning tutor can save and replace an https link; both participants read it');

    // 4. Participant/owner access.
    const beforeForeign = await stored(confirmedId);
    const hijack = `https://evil.example/${randomUUID()}`;
    for (const actor of [ids.student, ids.otherStudent, ids.otherTutor, ids.admin]) {
      const response = await putLink(actor, confirmedId, hijack);
      assert.equal(response.status, 403, `${roles[actor]} write -> ${response.status}`);
      assert.ok(!JSON.stringify(response.body).includes(link));
    }
    for (const actor of [ids.otherStudent, ids.otherTutor, ids.admin]) {
      const response = await readClass(actor, confirmedId);
      assert.equal(response.status, 403, `${roles[actor]} read -> ${response.status}`);
      assert.ok(!JSON.stringify(response.body).includes(link), 'Outsider must not see the link');
    }
    const anonymous = await request(server).get(`/api/v1/bookings/${confirmedId}/class-details`);
    const anonymousWrite = await request(server)
      .put(`/api/v1/bookings/tutor/${confirmedId}/meeting-link`)
      .send({ meetingUrl: hijack });
    assert.deepEqual([anonymous.status, anonymousWrite.status], [401, 401]);
    const missing = await putLink(ids.tutor, randomUUID(), hijack);
    assert.equal(missing.status, 404);
    assert.deepEqual(await stored(confirmedId), beforeForeign);
    pass('only the owning tutor writes; students, other tutors and admins get 403, anonymous 401');

    // 5. Booking state.
    const pendingId = await booking(false);
    const pendingWrite = await putLink(ids.tutor, pendingId, link);
    assert.equal(pendingWrite.status, 409, JSON.stringify(pendingWrite.body));
    assert.equal((await stored(pendingId)).meetingUrl, null);
    pass('a pending booking cannot receive a link (409)');

    const canceledLink = `https://meet.example.com/${randomUUID()}`;
    const canceledId = await booking();
    assert.equal((await putLink(ids.tutor, canceledId, canceledLink)).status, 200);
    const cancel = await call(ids.student, 'post', `/bookings/${canceledId}/cancel`, {
      reason: 'QA meeting link visibility',
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal((await stored(canceledId)).meetingUrl, canceledLink, 'Link is retained');
    for (const viewer of [ids.student, ids.tutor]) {
      const response = await readClass(viewer, canceledId);
      assert.equal(response.status, 200);
      assert.equal((response.body as { meetingUrl: string | null }).meetingUrl, null);
    }
    const canceledWrite = await putLink(ids.tutor, canceledId, link);
    assert.equal(canceledWrite.status, 409);
    assertNoLink(await participantReads(canceledId), canceledLink, 'canceled');
    pass('after cancellation the retained link is hidden from every participant read and frozen');

    const expiredLink = `https://meet.example.com/${randomUUID()}`;
    const expiredId = await booking(false);
    // EXPIRED has no API transition yet; simulate a legacy row that still carries a link.
    await prisma.$executeRaw`
      UPDATE "Booking" SET "status" = 'expired', "meetingUrl" = ${expiredLink}
      WHERE "id" = ${expiredId}::uuid
    `;
    assertNoLink(await participantReads(expiredId), expiredLink, 'expired');
    assert.equal((await putLink(ids.tutor, expiredId, link)).status, 409);
    pass('an expired booking hides a stored link and refuses writes');

    const completedLink = `https://meet.example.com/${randomUUID()}`;
    const completedId = await booking();
    assert.equal((await putLink(ids.tutor, completedId, completedLink)).status, 200);
    await prisma.booking.update({
      where: { id: completedId },
      data: {
        status: BookingStatus.COMPLETED,
        attendance: AttendanceStatus.ATTENDED,
        attendanceMarkedAt: new Date(),
      },
    });
    for (const viewer of [ids.student, ids.tutor]) {
      const response = await readClass(viewer, completedId);
      assert.equal((response.body as { meetingUrl: string }).meetingUrl, completedLink);
    }
    for (const actor of [ids.otherStudent, ids.otherTutor, ids.admin]) {
      const response = await readClass(actor, completedId);
      assert.equal(response.status, 403);
      assert.ok(!JSON.stringify(response.body).includes(completedLink));
    }
    pass('a completed class keeps its link visible to participants only');

    // 6. Concurrency: a link save racing a cancellation never exposes the link afterwards.
    for (let round = 0; round < 5; round += 1) {
      const raceId = await booking();
      const raceLink = `https://meet.example.com/${randomUUID()}`;
      const [write, raceCancel] = await Promise.all([
        putLink(ids.tutor, raceId, raceLink),
        call(ids.student, 'post', `/bookings/${raceId}/cancel`, { reason: 'QA race' }),
      ]);
      assert.equal(raceCancel.status, 200, JSON.stringify(raceCancel.body));
      assert.ok([200, 409].includes(write.status), `race write -> ${write.status}`);
      const after = await stored(raceId);
      assert.equal(after.status, BookingStatus.CANCELED);
      assert.equal(after.meetingUrl, write.status === 200 ? raceLink : null);
      assertNoLink(await participantReads(raceId), raceLink, 'race');
    }
    pass('five save-versus-cancel races end canceled with no 5xx and no visible link');

    // 7. Confirmed links never appear on list/notification surfaces or to outsiders.
    const outsiderReads = await Promise.all([
      call(ids.otherStudent, 'get', '/bookings/me'),
      call(ids.otherTutor, 'get', '/bookings/tutor'),
      call(ids.otherStudent, 'get', `/bookings/me/${confirmedId}`),
      call(ids.otherTutor, 'get', `/bookings/${confirmedId}/reschedule-requests/current`),
      call(ids.otherStudent, 'get', '/notifications'),
      call(ids.admin, 'get', '/notifications'),
    ]);
    assertNoLink(outsiderReads, link, 'outsider');
    const lists = await Promise.all([
      call(ids.student, 'get', '/bookings/me'),
      call(ids.tutor, 'get', '/bookings/tutor'),
      call(ids.student, 'get', '/notifications'),
      call(ids.tutor, 'get', '/notifications'),
    ]);
    assertNoLink(lists, link, 'list');
    pass(
      'the link only appears on the class-details read, never on lists, inboxes or to outsiders',
    );

    process.stdout.write(`Passed ${passed} meeting link checks.\n`);
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
        'Meeting link verification failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

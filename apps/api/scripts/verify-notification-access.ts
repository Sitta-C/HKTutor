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
import { Role, TutorVerificationStatus } from '@generated/prisma/enums';
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

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * S2-T31 QA: drives the real booking and notification HTTP routes, guards, services and
 * PostgreSQL together, then asserts what each recipient can see through their own inbox.
 * Nothing is mocked except the JWT secrets, which are random per run.
 */

export function disposableAccessDatabaseUrl(env: NodeJS.ProcessEnv): string {
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

interface InboxItem {
  id: string;
  eventType: string;
  title: string;
  bookingId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  unreadCount: number;
}

const INBOX_KEYS = ['bookingId', 'createdAt', 'eventType', 'id', 'readAt', 'title'];

async function verify(): Promise<void> {
  const databaseUrl = disposableAccessDatabaseUrl(process.env);
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomUUID(),
    JWT_REFRESH_SECRET: randomUUID(),
  });
  const prisma = new PrismaService(config);
  const ids = {
    studentA: randomUUID(),
    studentB: randomUUID(),
    tutor: randomUUID(),
    otherTutor: randomUUID(),
    admin: randomUUID(),
    subject: randomUUID(),
    grade: randomUUID(),
    listing: randomUUID(),
  };
  const users = [ids.studentA, ids.studentB, ids.tutor, ids.otherTutor, ids.admin];
  const tutors = [ids.tutor, ids.otherTutor];
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
      controllers: [BookingsController, NotificationsController],
      providers: [
        BookingsService,
        NotificationEventsService,
        NotificationsService,
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
    const events = moduleRef.get(NotificationEventsService);

    const roles: Record<string, Role> = {
      [ids.studentA]: Role.STUDENT,
      [ids.studentB]: Role.STUDENT,
      [ids.tutor]: Role.TUTOR,
      [ids.otherTutor]: Role.TUTOR,
      [ids.admin]: Role.ADMIN,
    };
    await prisma.user.createMany({
      data: users.map((id) => ({
        id,
        email: `${id}@notification-access.invalid`,
        role: roles[id] ?? Role.STUDENT,
        emailVerifiedAt: new Date(),
        consentAcceptedAt: new Date(),
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      })),
    });
    for (const userId of [ids.studentA, ids.studentB]) {
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
          bio: 'Notification access QA fixture',
          experienceYears: 0,
          verificationStatus: TutorVerificationStatus.VERIFIED,
        },
      });
    }
    await prisma.subject.create({
      data: { id: ids.subject, code: ids.subject, name: ids.subject },
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
        description: 'Synthetic notification access verification course',
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
          refreshTokenHash: `notification-access-${randomUUID()}`,
        },
      });
      const signed = jwt.signAccessToken(userId, session.id, roles[userId] ?? Role.STUDENT);
      sessions.set(userId, signed);
      return signed;
    }
    async function slot(): Promise<string> {
      const start = Date.UTC(2099, 1, 1) + slotSequence++ * 7_200_000;
      const row = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: ids.tutor,
          startAtUtc: new Date(start),
          endAtUtc: new Date(start + 3_600_000),
        },
      });
      return row.id;
    }
    async function call(
      userId: string,
      method: 'get' | 'post' | 'patch',
      path: string,
      body?: object,
    ): Promise<request.Response> {
      const pending = request(server)
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${await token(userId)}`);
      return body === undefined ? pending : pending.send(body);
    }
    async function book(userId: string, slotId: string): Promise<request.Response> {
      return call(userId, 'post', '/bookings', { listingId: ids.listing, slotId });
    }
    async function inbox(userId: string, query = ''): Promise<InboxPage> {
      const response = await call(userId, 'get', `/notifications${query}`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const page = response.body as InboxPage;
      for (const item of page.items) {
        assert.deepEqual(Object.keys(item).sort(), INBOX_KEYS, 'Inbox exposes only public fields');
      }
      return page;
    }
    /** Walks every page so assertions see the whole inbox, not just the default first 20. */
    async function fullInbox(userId: string): Promise<InboxItem[]> {
      const items: InboxItem[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor === null ? '?limit=2' : `?limit=2&cursor=${cursor}`;
        const page = await inbox(userId, query);
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return items;
    }
    function eventsFor(items: InboxItem[], bookingId: string): string[] {
      return items
        .filter((item) => item.bookingId === bookingId)
        .map((item) => item.eventType)
        .sort();
    }
    async function databaseRows() {
      return prisma.notification.findMany({
        where: { userId: { in: users } },
        orderBy: { id: 'asc' },
      });
    }

    // 1. Retried booking request: the duplicate is refused and produces no second notification.
    const firstSlot = await slot();
    const created = await book(ids.studentA, firstSlot);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const bookingA = (created.body as { id: string }).id;
    const afterCreate = await databaseRows();
    const retried = await book(ids.studentA, firstSlot);
    assert.equal(retried.status, 409, JSON.stringify(retried.body));
    assert.deepEqual(await databaseRows(), afterCreate);
    assert.deepEqual(eventsFor(await fullInbox(ids.tutor), bookingA), ['BOOKING_CREATED']);
    assert.deepEqual(await fullInbox(ids.studentA), []);
    pass('retried POST /bookings is refused and the tutor keeps exactly one created notification');

    // 2. Failed double booking from a different student, sequential and concurrent.
    const stolen = await book(ids.studentB, firstSlot);
    assert.equal(stolen.status, 409, JSON.stringify(stolen.body));
    assert.deepEqual(await databaseRows(), afterCreate);
    assert.deepEqual(await fullInbox(ids.studentB), []);
    pass('a second student booking a taken slot gets 409 and creates no notification for anyone');

    const raceSlot = await slot();
    const race = await Promise.all([book(ids.studentA, raceSlot), book(ids.studentB, raceSlot)]);
    assert.deepEqual(race.map((response) => response.status).sort(), [201, 409]);
    const winnerResponse = race.find((response) => response.status === 201);
    assert.ok(winnerResponse);
    const raceBooking = (winnerResponse.body as { id: string }).id;
    const raceRows = (await databaseRows()).filter((row) => row.bookingId === raceBooking);
    assert.equal(raceRows.length, 1);
    assert.equal(raceRows[0]?.userId, ids.tutor);
    assert.equal(raceRows[0]?.eventType, 'BOOKING_CREATED');
    assert.equal(
      await prisma.booking.count({ where: { slotId: raceSlot } }),
      1,
      'Only one booking may own the raced slot',
    );
    const loser = race[0]?.status === 409 ? ids.studentA : ids.studentB;
    assert.deepEqual(eventsFor(await fullInbox(loser), raceBooking), []);
    pass('concurrent HTTP double booking yields one 201, one 409 and one tutor notification');

    // 3. Retried and concurrent tutor decisions.
    const confirmed = await call(ids.tutor, 'post', `/bookings/tutor/${bookingA}/confirm`, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const afterConfirm = await databaseRows();
    for (const path of ['confirm', 'reject']) {
      const retry = await call(ids.tutor, 'post', `/bookings/tutor/${bookingA}/${path}`, {});
      assert.equal(retry.status, 409, `${path}: ${JSON.stringify(retry.body)}`);
    }
    assert.deepEqual(await databaseRows(), afterConfirm);
    assert.deepEqual(eventsFor(await fullInbox(ids.studentA), bookingA), ['BOOKING_CONFIRMED']);
    pass(
      'repeating confirm, or rejecting after confirm, returns 409 and adds no false notification',
    );

    const decisionBookingResponse = await book(ids.studentB, await slot());
    assert.equal(decisionBookingResponse.status, 201);
    const decisionBooking = (decisionBookingResponse.body as { id: string }).id;
    const decisions = await Promise.all([
      call(ids.tutor, 'post', `/bookings/tutor/${decisionBooking}/confirm`, {}),
      call(ids.tutor, 'post', `/bookings/tutor/${decisionBooking}/reject`, {}),
      call(ids.tutor, 'post', `/bookings/tutor/${decisionBooking}/confirm`, {}),
    ]);
    assert.equal(decisions.filter((response) => response.status === 200).length, 1);
    assert.equal(decisions.filter((response) => response.status === 409).length, 2);
    const decided = await prisma.booking.findUniqueOrThrow({ where: { id: decisionBooking } });
    const expectedEvent = decided.status === 'CONFIRMED' ? 'BOOKING_CONFIRMED' : 'BOOKING_REJECTED';
    assert.deepEqual(eventsFor(await fullInbox(ids.studentB), decisionBooking), [expectedEvent]);
    pass(
      'concurrent confirm/reject/confirm commits one decision and exactly one matching notification',
    );

    // 4. Retried cancellation: once by the student, once by the tutor on another booking.
    const firstCancel = await call(ids.studentA, 'post', `/bookings/${bookingA}/cancel`, {
      reason: 'QA retry check',
    });
    assert.equal(firstCancel.status, 200, JSON.stringify(firstCancel.body));
    const afterCancel = await databaseRows();
    const secondCancel = await call(ids.studentA, 'post', `/bookings/${bookingA}/cancel`, {
      reason: 'QA retry check',
    });
    assert.equal(secondCancel.status, 409, JSON.stringify(secondCancel.body));
    assert.deepEqual(await databaseRows(), afterCancel);
    const tutorCancel = await call(ids.tutor, 'post', `/bookings/${raceBooking}/cancel`, {
      reason: 'QA tutor cancellation',
    });
    assert.equal(tutorCancel.status, 200, JSON.stringify(tutorCancel.body));
    pass('a repeated cancellation returns 409 and does not notify twice');

    // 5. No self-notification and no notification for anyone outside the booking.
    const tutorItems = await fullInbox(ids.tutor);
    const studentAItems = await fullInbox(ids.studentA);
    assert.deepEqual(eventsFor(tutorItems, bookingA), ['BOOKING_CANCELED', 'BOOKING_CREATED']);
    assert.deepEqual(eventsFor(studentAItems, bookingA), ['BOOKING_CONFIRMED']);
    assert.deepEqual(eventsFor(tutorItems, raceBooking), ['BOOKING_CREATED']);
    assert.deepEqual(eventsFor(await fullInbox(winnerOf(race, ids)), raceBooking), [
      'BOOKING_CANCELED',
    ]);
    for (const outsider of [ids.otherTutor, ids.admin]) {
      assert.deepEqual(await fullInbox(outsider), []);
    }
    const studentOnly = new Set(['BOOKING_CONFIRMED', 'BOOKING_REJECTED']);
    for (const row of await databaseRows()) {
      const booking = await prisma.booking.findUniqueOrThrow({
        where: { id: row.bookingId ?? '' },
      });
      assert.ok(
        row.userId === booking.studentUserId || row.userId === booking.tutorProfileId,
        'Recipient must be a booking participant',
      );
      if (row.eventType === 'BOOKING_CREATED') {
        assert.equal(
          row.userId,
          booking.tutorProfileId,
          'The booking student is never told of their own request',
        );
      }
      if (studentOnly.has(row.eventType)) {
        assert.equal(
          row.userId,
          booking.studentUserId,
          'The tutor is never told of their own decision',
        );
      }
      if (row.eventType === 'BOOKING_CANCELED') {
        assert.notEqual(row.userId, booking.canceledById, 'The canceler is never notified');
      }
    }
    pass('every persisted notification targets the counterparty, never the actor or an outsider');

    // A retried event write (e.g. a replayed transaction) must collapse onto the saved row.
    for (const row of await databaseRows()) {
      assert.equal(row.eventKey, `${row.eventType}:${row.bookingId ?? ''}`, 'Stable event key');
    }
    const replayBooking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingA } });
    const beforeReplay = await databaseRows();
    const tutorInboxBeforeReplay = await fullInbox(ids.tutor);
    await Promise.all(
      [0, 1, 2].map(() =>
        prisma.$transaction((tx) =>
          events.write(tx, {
            actorUserId: replayBooking.studentUserId,
            booking: replayBooking,
            eventType: 'BOOKING_CREATED',
          }),
        ),
      ),
    );
    assert.deepEqual(await databaseRows(), beforeReplay);
    assert.deepEqual(await fullInbox(ids.tutor), tutorInboxBeforeReplay);
    pass('replayed event writes leave the recipient inbox and saved rows unchanged');

    // 6. Cross-user inbox access.
    const tutorUnread = (await inbox(ids.tutor)).unreadCount;
    assert.ok(tutorUnread >= 3);
    const foreign = tutorItems[0];
    assert.ok(foreign);
    const studentForeign = studentAItems[0];
    assert.ok(studentForeign);
    const outsiderView = await inbox(ids.studentB);
    assert.ok(outsiderView.items.every((item) => !tutorItems.some((own) => own.id === item.id)));

    for (const query of [`?userId=${ids.tutor}`, `?recipientId=${ids.tutor}`]) {
      const response = await call(ids.studentB, 'get', `/notifications${query}`);
      assert.equal(response.status, 400, `${query} must not select another inbox`);
    }
    const tutorPage = await inbox(ids.tutor, '?limit=1');
    assert.ok(tutorPage.nextCursor);
    const borrowedCursor = await inbox(ids.otherTutor, `?cursor=${tutorPage.nextCursor}`);
    assert.deepEqual(
      borrowedCursor.items,
      [],
      'A cursor copied from another inbox reveals nothing',
    );
    pass('list endpoints only ever return the caller’s own notifications');

    const beforeForeignWrites = await databaseRows();
    const foreignAttempts: [string, InboxItem][] = [
      [ids.studentB, foreign],
      [ids.otherTutor, foreign],
      [ids.admin, foreign],
      [ids.tutor, studentForeign],
    ];
    for (const [actor, target] of foreignAttempts) {
      const response = await call(actor, 'patch', `/notifications/${target.id}/read`, {});
      assert.equal(response.status, 403, JSON.stringify(response.body));
      const text = JSON.stringify(response.body);
      for (const secret of [target.title, target.eventType, target.bookingId ?? '']) {
        assert.ok(!text.includes(secret), 'A 403 must not echo the foreign notification');
      }
    }
    const missing = await call(ids.studentB, 'patch', `/notifications/${randomUUID()}/read`, {});
    assert.equal(missing.status, 404);
    for (const outsider of [ids.otherTutor, ids.admin]) {
      const bulk = await call(outsider, 'post', '/notifications/read-all', {});
      assert.equal(bulk.status, 200);
      assert.deepEqual(bulk.body, { updatedCount: 0, readAt: null });
    }
    assert.deepEqual(await databaseRows(), beforeForeignWrites);
    // Student B owns notifications too: read-all may mark exactly those and nothing else.
    const studentBUnread = (await inbox(ids.studentB)).unreadCount;
    const studentBBulk = await call(ids.studentB, 'post', '/notifications/read-all', {});
    assert.equal(studentBBulk.status, 200);
    assert.equal((studentBBulk.body as { updatedCount: number }).updatedCount, studentBUnread);
    const othersAfter = (await databaseRows()).filter((row) => row.userId !== ids.studentB);
    assert.deepEqual(
      othersAfter,
      beforeForeignWrites.filter((row) => row.userId !== ids.studentB),
    );
    assert.equal((await inbox(ids.tutor)).unreadCount, tutorUnread);
    pass('marking another user’s notification read returns 403/404 and changes no read state');

    const ownReads = await Promise.all([
      call(ids.tutor, 'patch', `/notifications/${foreign.id}/read`, {}),
      call(ids.tutor, 'patch', `/notifications/${foreign.id}/read`, {}),
    ]);
    assert.deepEqual(
      ownReads.map((response) => response.status),
      [200, 200],
    );
    const receipts = ownReads.map((response) => (response.body as { readAt: string }).readAt);
    assert.equal(receipts[0], receipts[1], 'Concurrent own reads keep the first receipt');
    const studentUnreadBefore = (await inbox(ids.studentA)).unreadCount;
    const tutorBulk = await call(ids.tutor, 'post', '/notifications/read-all', {});
    assert.equal(tutorBulk.status, 200);
    assert.equal((await inbox(ids.tutor)).unreadCount, 0);
    assert.equal((await inbox(ids.studentA)).unreadCount, studentUnreadBefore);
    assert.ok(studentUnreadBefore > 0);
    pass('own read and read-all are idempotent and never touch the counterparty inbox');

    const revokedSession = await prisma.authSession.create({
      data: {
        userId: ids.studentB,
        expiresAt: new Date(Date.now() + 3_600_000),
        refreshTokenHash: `notification-access-${randomUUID()}`,
        revokedAt: new Date(),
      },
    });
    const revoked = jwt.signAccessToken(ids.studentB, revokedSession.id, Role.STUDENT);
    const tutorSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: ids.tutor },
    });
    const mismatched = jwt.signAccessToken(ids.studentB, tutorSession.id, Role.STUDENT);
    for (const bearer of [revoked, mismatched]) {
      const response = await request(server)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${bearer}`);
      assert.equal(response.status, 401);
    }
    const anonymous = await request(server).get('/api/v1/notifications');
    assert.equal(anonymous.status, 401);
    pass('revoked, borrowed-session and missing tokens cannot open any inbox');

    process.stdout.write(`Passed ${passed} notification access checks.\n`);
  } finally {
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: users } } });
      await prisma.booking.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.availabilitySlot.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.teachingListing.deleteMany({ where: { id: ids.listing } });
      await prisma.authSession.deleteMany({ where: { userId: { in: users } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: tutors } } });
      await prisma.studentProfile.deleteMany({
        where: { userId: { in: [ids.studentA, ids.studentB] } },
      });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.subject.deleteMany({ where: { id: ids.subject } });
      await prisma.gradeLevel.deleteMany({ where: { id: ids.grade } });
    } finally {
      await app?.close();
      await prisma.$disconnect();
    }
  }
}

function winnerOf(race: request.Response[], ids: { studentA: string; studentB: string }): string {
  return race[0]?.status === 201 ? ids.studentA : ids.studentB;
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Unknown failure'}\n` +
        'Notification access verification failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

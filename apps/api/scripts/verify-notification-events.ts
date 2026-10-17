import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { BookingStatus, Role, TutorVerificationStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

import type { NotificationEvent } from '@modules/notifications/notification-events.service';
import type { TestingModule } from '@nestjs/testing';

type EventType = NotificationEvent['eventType'];

export function disposableEventDatabaseUrl(env: NodeJS.ProcessEnv): string {
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

async function verify(): Promise<void> {
  const databaseUrl = disposableEventDatabaseUrl(process.env);
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const studentId = randomUUID();
  const tutorId = randomUUID();
  const subjectId = randomUUID();
  const gradeId = randomUUID();
  const listingId = randomUUID();
  const users = [studentId, tutorId];
  let moduleRef: TestingModule | undefined;
  let failAfterEventType: EventType | undefined;
  let slotSequence = 0;
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [real services + PostgreSQL] ${label}\n`);
  };

  try {
    await prisma.$connect();
    const target = await prisma.$queryRaw<{ database: string; schema: string }[]>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)), schema: 'public' },
    ]);
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    assert.equal(
      applied.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
    );
    const finished = new Set(
      applied
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    );
    assert.deepEqual(
      committed.filter((name) => !finished.has(name)),
      [],
      'Apply all migrations first',
    );

    // The insert and domain writes stay real; only fail AFTER an actual Notification insert.
    const observed = prisma.$extends({
      query: {
        notification: {
          async createMany({ args, query }) {
            const result = await query(args);
            const data = Array.isArray(args.data) ? args.data : [args.data];
            if (result.count > 0 && data.some((row) => row.eventType === failAfterEventType)) {
              throw new Error('Injected notification write failure after real insert');
            }
            return result;
          },
        },
      },
    });
    moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        RescheduleRequestsService,
        NotificationEventsService,
        { provide: PrismaService, useValue: observed },
      ],
    }).compile();
    const bookings = moduleRef.get(BookingsService);
    const reschedules = moduleRef.get(RescheduleRequestsService);
    const events = moduleRef.get(NotificationEventsService);

    await prisma.user.createMany({
      data: [
        { id: studentId, email: `${studentId}@notification-events.invalid`, role: Role.STUDENT },
        { id: tutorId, email: `${tutorId}@notification-events.invalid`, role: Role.TUTOR },
      ].map((user) => ({
        ...user,
        emailVerifiedAt: new Date(),
        consentAcceptedAt: new Date(),
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      })),
    });
    await prisma.studentProfile.create({
      data: {
        userId: studentId,
        firstName: 'Test',
        lastName: 'Student',
        nickname: 'Learner',
        school: 'Synthetic school',
        gradeLevel: '10',
        phone: '0800000000',
      },
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutorId,
        displayName: 'Synthetic tutor',
        bio: 'Notification test fixture',
        experienceYears: 0,
        verificationStatus: TutorVerificationStatus.VERIFIED,
      },
    });
    await prisma.subject.create({ data: { id: subjectId, code: subjectId, name: subjectId } });
    await prisma.gradeLevel.create({
      data: { id: gradeId, code: gradeId, name: gradeId, sortOrder: 1 },
    });
    await prisma.teachingListing.create({
      data: {
        id: listingId,
        tutorProfileId: tutorId,
        subjectId,
        gradeLevelId: gradeId,
        pricePerHour: '450.00',
        description: 'Synthetic notification event verification course',
        publicationStatus: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    async function slot(): Promise<string> {
      const row = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: tutorId,
          startAtUtc: new Date(Date.UTC(2099, 0, 1) + slotSequence * 7_200_000),
          endAtUtc: new Date(Date.UTC(2099, 0, 1) + slotSequence++ * 7_200_000 + 3_600_000),
        },
      });
      return row.id;
    }
    async function fixture(status: BookingStatus = BookingStatus.CONFIRMED) {
      return prisma.booking.create({
        data: {
          studentUserId: studentId,
          tutorProfileId: tutorId,
          listingId,
          slotId: await slot(),
          status,
          subtotalAmount: '450.00',
          netAmount: '450.00',
        },
      });
    }
    async function notice(
      eventType: EventType,
      entityId: string,
      recipient: string,
    ): Promise<void> {
      const rows = await prisma.notification.findMany({
        where: { eventKey: `${eventType}:${entityId}` },
      });
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.ok(row);
      assert.equal(row.userId, recipient);
      assert.equal(row.readAt, null);
      assert.ok(row.title.trim() && row.body.trim());
    }
    async function snapshot() {
      return {
        bookings: await prisma.booking.findMany({
          where: { tutorProfileId: tutorId },
          orderBy: { id: 'asc' },
        }),
        requests: await prisma.rescheduleRequest.findMany({
          where: { booking: { tutorProfileId: tutorId } },
          orderBy: { id: 'asc' },
        }),
        notices: await prisma.notification.findMany({
          where: { userId: { in: users } },
          orderBy: { id: 'asc' },
        }),
        slots: await prisma.availabilitySlot.findMany({
          where: { tutorProfileId: tutorId },
          orderBy: { id: 'asc' },
        }),
      };
    }

    const created = await bookings.create({
      studentUserId: studentId,
      listingId,
      slotId: await slot(),
    });
    await notice('BOOKING_CREATED', created.id, tutorId);
    await bookings.confirmTutorBooking({ bookingId: created.id, tutorUserId: tutorId });
    await notice('BOOKING_CONFIRMED', created.id, studentId);
    const rejected = await fixture(BookingStatus.PENDING);
    await bookings.rejectTutorBooking({ bookingId: rejected.id, tutorUserId: tutorId });
    await notice('BOOKING_REJECTED', rejected.id, studentId);
    pass('create, confirm and reject select the correct recipient');

    for (const actor of users) {
      const item = await fixture();
      await bookings.cancelBooking({
        bookingId: item.id,
        userId: actor,
        reason: 'Synthetic cancellation',
      });
      await notice('BOOKING_CANCELED', item.id, actor === studentId ? tutorId : studentId);
    }
    pass('student and tutor cancellation notify only the counterparty');

    const item = await fixture();
    const first = await reschedules.create(studentId, Role.STUDENT, item.id, {
      targetSlotId: await slot(),
    });
    await notice('RESCHEDULE_REQUESTED', first.requestId, tutorId);
    await reschedules.reject(tutorId, first.requestId);
    await notice('RESCHEDULE_REJECTED', first.requestId, studentId);
    const second = await reschedules.create(tutorId, Role.TUTOR, item.id, {
      targetSlotId: await slot(),
    });
    await notice('RESCHEDULE_REQUESTED', second.requestId, studentId);
    await reschedules.approve(studentId, second.requestId);
    await notice('RESCHEDULE_APPROVED', second.requestId, tutorId);
    const third = await reschedules.create(studentId, Role.STUDENT, item.id, {
      targetSlotId: await slot(),
    });
    await reschedules.withdraw(studentId, third.requestId);
    await notice('RESCHEDULE_WITHDRAWN', third.requestId, tutorId);
    assert.equal(await prisma.notification.count({ where: { bookingId: item.id } }), 6);
    pass('all reschedule outcomes, both requester roles and multiple rounds remain distinct');

    const beforeInvalid = await snapshot();
    await assert.rejects(
      bookings.confirmTutorBooking({ bookingId: rejected.id, tutorUserId: tutorId }),
    );
    await assert.rejects(
      bookings.confirmTutorBooking({ bookingId: created.id, tutorUserId: randomUUID() }),
    );
    await assert.rejects(reschedules.approve(tutorId, first.requestId));
    assert.deepEqual(await snapshot(), beforeInvalid);
    pass('failed/repeated/unauthorized actions create no false notification');

    const raceSlot = await slot();
    const race = await Promise.allSettled([
      bookings.create({ studentUserId: studentId, listingId, slotId: raceSlot }),
      bookings.create({ studentUserId: studentId, listingId, slotId: raceSlot }),
    ]);
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    const winner = await prisma.booking.findFirstOrThrow({ where: { slotId: raceSlot } });
    assert.equal(await prisma.booking.count({ where: { slotId: raceSlot } }), 1);
    await notice('BOOKING_CREATED', winner.id, tutorId);
    pass('concurrent booking attempts create exactly one booking and one notification');

    for (const competing of ['reject', 'withdraw'] as const) {
      const booking = await fixture();
      const pending = await reschedules.create(studentId, Role.STUDENT, booking.id, {
        targetSlotId: await slot(),
      });
      const outcomes = await Promise.allSettled([
        reschedules.approve(tutorId, pending.requestId),
        competing === 'reject'
          ? reschedules.reject(tutorId, pending.requestId)
          : reschedules.withdraw(studentId, pending.requestId),
      ]);
      assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
      const loser = outcomes.find((result) => result.status === 'rejected');
      assert.ok(loser && loser.status === 'rejected');
      assert.ok(loser.reason instanceof ConflictException, 'Losing decision must be a domain 409');
      const decided = await prisma.rescheduleRequest.findUniqueOrThrow({
        where: { id: pending.requestId },
      });
      const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      const type =
        decided.status === 'APPROVED'
          ? 'RESCHEDULE_APPROVED'
          : decided.status === 'REJECTED'
            ? 'RESCHEDULE_REJECTED'
            : 'RESCHEDULE_WITHDRAWN';
      await notice(type, pending.requestId, type === 'RESCHEDULE_WITHDRAWN' ? tutorId : studentId);
      assert.equal(await prisma.notification.count({ where: { bookingId: booking.id } }), 2);
      assert.equal(
        finalBooking.slotId,
        decided.status === 'APPROVED' ? decided.requestedSlotId : booking.slotId,
      );
      pass(`approve versus ${competing}: one decision/event, no deadlock or false notification`);
    }

    const replayBooking = await fixture();
    const replay: NotificationEvent = {
      actorUserId: studentId,
      booking: replayBooking,
      eventType: 'BOOKING_CANCELED',
    };
    await Promise.all([
      prisma.$transaction((tx) => events.write(tx, replay)),
      prisma.$transaction((tx) => events.write(tx, replay)),
    ]);
    const original = await prisma.notification.findUniqueOrThrow({
      where: {
        userId_eventKey: { userId: tutorId, eventKey: `BOOKING_CANCELED:${replayBooking.id}` },
      },
    });
    const saved = await prisma.notification.update({
      where: { id: original.id },
      data: {
        readAt: new Date(original.createdAt.getTime() + 1000),
        title: 'Original saved title',
      },
    });
    await prisma.$transaction((tx) => events.write(tx, replay));
    assert.deepEqual(
      await prisma.notification.findUniqueOrThrow({ where: { id: saved.id } }),
      saved,
    );
    assert.equal(await prisma.notification.count({ where: { bookingId: replayBooking.id } }), 1);
    pass(
      'concurrent/repeated event writes preserve original ID, content, read time and creation time',
    );

    async function prepare(eventType: EventType): Promise<() => Promise<unknown>> {
      if (eventType === 'BOOKING_CREATED') {
        const slotId = await slot();
        return () => bookings.create({ studentUserId: studentId, listingId, slotId });
      }
      const row = await fixture(
        eventType === 'BOOKING_CONFIRMED' || eventType === 'BOOKING_REJECTED'
          ? BookingStatus.PENDING
          : BookingStatus.CONFIRMED,
      );
      if (eventType === 'BOOKING_CONFIRMED') {
        return () => bookings.confirmTutorBooking({ bookingId: row.id, tutorUserId: tutorId });
      }
      if (eventType === 'BOOKING_REJECTED') {
        return () => bookings.rejectTutorBooking({ bookingId: row.id, tutorUserId: tutorId });
      }
      if (eventType === 'BOOKING_CANCELED') {
        return () =>
          bookings.cancelBooking({
            bookingId: row.id,
            userId: studentId,
            reason: 'Rollback fixture',
          });
      }
      const targetSlotId = await slot();
      if (eventType === 'RESCHEDULE_REQUESTED') {
        return () => reschedules.create(studentId, Role.STUDENT, row.id, { targetSlotId });
      }
      const pending = await reschedules.create(studentId, Role.STUDENT, row.id, { targetSlotId });
      if (eventType === 'RESCHEDULE_APPROVED') {
        return () => reschedules.approve(tutorId, pending.requestId);
      }
      if (eventType === 'RESCHEDULE_REJECTED') {
        return () => reschedules.reject(tutorId, pending.requestId);
      }
      return () => reschedules.withdraw(studentId, pending.requestId);
    }
    const types: EventType[] = [
      'BOOKING_CREATED',
      'BOOKING_CONFIRMED',
      'BOOKING_REJECTED',
      'BOOKING_CANCELED',
      'RESCHEDULE_REQUESTED',
      'RESCHEDULE_APPROVED',
      'RESCHEDULE_REJECTED',
      'RESCHEDULE_WITHDRAWN',
    ];
    for (const type of types) {
      const action = await prepare(type);
      const before = await snapshot();
      failAfterEventType = type;
      await assert.rejects(action(), /Injected notification write failure/);
      failAfterEventType = undefined;
      assert.deepEqual(await snapshot(), before);
      pass(`${type}: post-insert failure rolls back notification, booking, request and slot state`);
    }
    process.stdout.write(`Passed ${passed} notification event database checks.\n`);
  } finally {
    failAfterEventType = undefined;
    try {
      await prisma.notification.deleteMany({ where: { userId: { in: users } } });
      await prisma.rescheduleRequest.deleteMany({
        where: { booking: { tutorProfileId: tutorId } },
      });
      await prisma.booking.deleteMany({ where: { tutorProfileId: tutorId } });
      await prisma.availabilitySlot.deleteMany({ where: { tutorProfileId: tutorId } });
      await prisma.teachingListing.deleteMany({ where: { id: listingId } });
      await prisma.tutorProfile.deleteMany({ where: { userId: tutorId } });
      await prisma.studentProfile.deleteMany({ where: { userId: studentId } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.subject.deleteMany({ where: { id: subjectId } });
      await prisma.gradeLevel.deleteMany({ where: { id: gradeId } });
    } finally {
      await moduleRef?.close();
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void verify().catch(() => {
    process.stderr.write(
      'Notification event verification failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

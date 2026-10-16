import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import 'reflect-metadata';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import {
  BookingStatus,
  ListingPublicationStatus,
  RescheduleRequestStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import {
  BookingRescheduleRequestsController,
  RescheduleRequestsController,
} from '@modules/reschedule-requests/reschedule-requests.controller';
import {
  DEFAULT_RESCHEDULE_REASON,
  RescheduleRequestsService,
} from '@modules/reschedule-requests/reschedule-requests.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

type Decision = 'approve' | 'reject' | 'withdraw';
interface Actor {
  id: string;
  role: Role;
  token: string;
}
interface Fixture {
  bookingId: string;
  slotId: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SECOND_MS = 1000;
const PRICE = '500.00';

// disposableDatabaseUrl and installControlledClock mirror verify-booking-cancellation.ts: each
// verifier stays self-contained, and scripts have no import alias to share them.

/** No dotenv/AppModule import: an omitted URL must never select the shared project database. */
export function disposableDatabaseUrl(): string {
  assert.equal(
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable database approval is required',
  );
  const value = process.env['DATABASE_URL'];
  assert.ok(value, 'Set the disposable DATABASE_URL explicitly');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid disposable PostgreSQL URL');
  }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL is required');
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname),
    'Only loopback is allowed',
  );
  assert.match(
    decodeURIComponent(url.pathname.slice(1)),
    /^hktutor[-_]/,
    'Use a disposable hktutor- or hktutor_ database',
  );
  assert.equal(url.search, '', 'Database URL options/schema overrides are not allowed');
  assert.equal(url.hash, '', 'Database URL fragments are not allowed');
  return value;
}

/**
 * Freezes `new Date()` and `Date.now()` in this process only, so the service's cutoff can be
 * checked at exact boundaries against real PostgreSQL timestamps. Install it before any Date is
 * created: instances of the native Date are not instances of the replacement class.
 */
export function installControlledClock() {
  const NativeDate = Date;
  let frozen: number | undefined;

  class ControlledDate extends NativeDate {
    constructor(...args: unknown[]) {
      if (args.length === 0 && frozen !== undefined) {
        super(frozen);
      } else {
        super(...(args as ConstructorParameters<DateConstructor>));
      }
    }

    static override now(): number {
      return frozen ?? NativeDate.now();
    }
  }

  globalThis.Date = ControlledDate as DateConstructor;
  return {
    freeze(at: number): void {
      frozen = at;
    },
    release(): void {
      frozen = undefined;
    },
    uninstall(): void {
      frozen = undefined;
      globalThis.Date = NativeDate;
    },
  };
}

async function main(): Promise<void> {
  const clock = installControlledClock();
  const databaseUrl = disposableDatabaseUrl();
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  // Holds a slot's row lock for the race checks without using the application's own pool.
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const jwt = new JwtTokenService(
    new AuthConfigService(
      new ConfigService({
        JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
        JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
        JWT_ISSUER: 'hktutor-s2-t27-verifier',
        JWT_AUDIENCE: 'hktutor-s2-t27-verifier',
      }),
    ),
  );
  const created = {
    users: [] as string[],
    bookings: [] as string[],
    slots: [] as string[],
    listings: [] as string[],
    subjects: [] as string[],
    grades: [] as string[],
  };
  let app: INestApplication<App> | undefined;
  let passed = 0;
  let slotSequence = 0;
  let instantSequence = 0;

  function pass(label: string): void {
    passed += 1;
    process.stdout.write(`PASS [real HTTP + PostgreSQL] ${label}\n`);
  }

  try {
    await prisma.$connect();
    const target = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)), schema: 'public' },
    ]);
    const committedMigrations = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
    >`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
    `;
    const applied = new Set(
      migrations
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    );
    assert.deepEqual(
      committedMigrations.filter((name) => !applied.has(name)),
      [],
      'Apply all committed migrations before verification',
    );

    const module = await Test.createTestingModule({
      controllers: [
        BookingsController,
        BookingRescheduleRequestsController,
        RescheduleRequestsController,
      ],
      providers: [
        BookingsService,
        RescheduleRequestsService,
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtTokenService, useValue: jwt },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
    const server = app.getHttpServer();

    // Active, consenting users; the tutor is verified and the students have profiles, so the
    // real booking API accepts them when a check needs to prove a slot is bookable.
    async function actor(role: Role): Promise<Actor> {
      const id = randomUUID();
      created.users.push(id);
      await prisma.user.create({
        data: {
          id,
          email: `${id}@s2-t27.invalid`,
          role,
          emailVerifiedAt: new Date(),
          consentAcceptedAt: new Date(),
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        },
      });
      if (role === Role.TUTOR) {
        await prisma.tutorProfile.create({
          data: {
            userId: id,
            displayName: 'Reschedule QA tutor',
            bio: 'Synthetic fixture',
            experienceYears: 0,
            verificationStatus: TutorVerificationStatus.VERIFIED,
          },
        });
      }
      if (role === Role.STUDENT) {
        await prisma.studentProfile.create({
          data: {
            userId: id,
            firstName: 'Synthetic',
            lastName: 'Student',
            nickname: 'S2-T27',
            school: 'S2-T27 Fixture School',
            gradeLevel: 'Grade 10',
            phone: '0000000000',
          },
        });
      }
      const session = await prisma.authSession.create({
        data: {
          userId: id,
          expiresAt: new Date(Date.now() + HOUR_MS),
          refreshTokenHash: randomBytes(32).toString('hex'),
        },
      });
      return { id, role, token: jwt.signAccessToken(id, session.id, role) };
    }

    const tutor = await actor(Role.TUTOR);
    const student = await actor(Role.STUDENT);
    const otherTutor = await actor(Role.TUTOR);
    const otherStudent = await actor(Role.STUDENT);
    const admin = await actor(Role.ADMIN);
    const subjectId = randomUUID();
    const gradeLevelId = randomUUID();
    const listingId = randomUUID();
    created.subjects.push(subjectId);
    created.grades.push(gradeLevelId);
    created.listings.push(listingId);
    await prisma.subject.create({ data: { id: subjectId, code: subjectId, name: subjectId } });
    await prisma.gradeLevel.create({
      data: { id: gradeLevelId, code: gradeLevelId, name: gradeLevelId, sortOrder: 1 },
    });
    await prisma.teachingListing.create({
      data: {
        id: listingId,
        tutorProfileId: tutor.id,
        subjectId,
        gradeLevelId,
        pricePerHour: PRICE,
        description: 'Synthetic teaching listing for isolated reschedule QA verification.',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    // Default slots are far in the future and two hours apart, so no two live slots of one tutor
    // overlap (AvailabilitySlot_no_overlap_excl).
    async function slot(
      startAtUtc = new Date(Date.UTC(2099, 0, 1) + slotSequence++ * 2 * HOUR_MS),
      tutorProfileId = tutor.id,
      durationMs = HOUR_MS,
    ): Promise<string> {
      const id = randomUUID();
      created.slots.push(id);
      await prisma.availabilitySlot.create({
        data: {
          id,
          tutorProfileId,
          startAtUtc,
          endAtUtc: new Date(startAtUtc.getTime() + durationMs),
        },
      });
      return id;
    }

    async function addBooking(
      slotId: string,
      status: BookingStatus = BookingStatus.CONFIRMED,
      studentUserId = student.id,
    ): Promise<string> {
      const id = randomUUID();
      created.bookings.push(id);
      await prisma.booking.create({
        data: {
          id,
          slotId,
          listingId,
          studentUserId,
          tutorProfileId: tutor.id,
          status,
          subtotalAmount: PRICE,
          netAmount: PRICE,
          ...(status === BookingStatus.CANCELED
            ? {
                canceledAt: new Date(),
                canceledById: tutor.id,
                cancellationReason: 'Original cancellation',
              }
            : {}),
        },
      });
      return id;
    }

    async function fixture(
      status: BookingStatus = BookingStatus.CONFIRMED,
      startAtUtc?: Date,
      durationMs?: number,
    ): Promise<Fixture> {
      const slotId = await slot(startAtUtc, tutor.id, durationMs);
      return { bookingId: await addBooking(slotId, status), slotId };
    }

    /** Inserts a pending request directly, so each decision check starts from a known state. */
    async function pendingRequest(
      item: Fixture,
      targetSlotId: string,
      requester: Actor = student,
    ): Promise<string> {
      const row = await prisma.rescheduleRequest.create({
        data: {
          bookingId: item.bookingId,
          fromSlotId: item.slotId,
          requestedSlotId: targetSlotId,
          requestedById: requester.id,
          reason: 'Synthetic pending request',
        },
      });
      return row.id;
    }

    /**
     * An instant a few seconds ahead, unique per call so the 1 ms slots built from it never
     * overlap. Frozen times stay close to the real clock, inside the session and token lifetimes.
     */
    function nextInstant(): number {
      return Math.ceil(Date.now() / SECOND_MS) * SECOND_MS + 2 * SECOND_MS + instantSequence++;
    }

    function post(path: string, user: Actor | undefined, body: object = {}): request.Test {
      const call = request(server)
        .post(`/api/v1/${path}`)
        .send(body)
        .timeout({ response: 10_000, deadline: 15_000 });
      return user ? call.set('Authorization', `Bearer ${user.token}`) : call;
    }

    function requestReschedule(
      bookingId: string,
      user: Actor | undefined,
      targetSlotId: string,
    ): request.Test {
      return post(`bookings/${bookingId}/reschedule-requests`, user, { targetSlotId });
    }

    function decide(action: Decision, requestId: string, user: Actor | undefined): request.Test {
      return post(`reschedule-requests/${requestId}/${action}`, user);
    }

    async function frozenAt(at: number, call: () => request.Test): Promise<request.Response> {
      clock.freeze(at);
      try {
        return await call();
      } finally {
        clock.release();
      }
    }

    async function expectStatus(
      call: PromiseLike<request.Response>,
      status: number,
      label: string,
    ): Promise<request.Response> {
      const response = await call;
      assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
      return response;
    }

    function field(body: unknown, key: string): unknown {
      assert.ok(body && typeof body === 'object' && key in body, `Expected "${key}" in the body`);
      return (body as Record<string, unknown>)[key];
    }

    /** Books a slot through the real booking API: proof that the slot is free and bookable. */
    async function book(slotId: string, user: Actor): Promise<string> {
      const response = await expectStatus(
        post('bookings', user, { listingId, slotId }),
        201,
        `Booking slot ${slotId}`,
      );
      const id = field(response.body as unknown, 'id');
      assert.ok(typeof id === 'string');
      created.bookings.push(id);
      return id;
    }

    /** Every row this run created. A rejected action must leave all of them exactly as they were. */
    async function world() {
      const [bookings, slots, requests] = await Promise.all([
        prisma.booking.findMany({
          where: { id: { in: created.bookings } },
          orderBy: { id: 'asc' },
        }),
        prisma.availabilitySlot.findMany({
          where: { id: { in: created.slots } },
          orderBy: { id: 'asc' },
        }),
        prisma.rescheduleRequest.findMany({
          where: { bookingId: { in: created.bookings } },
          orderBy: { id: 'asc' },
        }),
      ]);
      return { bookings, slots, requests };
    }
    type World = Awaited<ReturnType<typeof world>>;

    async function activeHolders(slotIds: string[]): Promise<Record<string, string[]>> {
      const rows = await prisma.booking.findMany({
        where: {
          slotId: { in: slotIds },
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        },
        select: { id: true, slotId: true },
        orderBy: { id: 'asc' },
      });
      return Object.fromEntries(
        slotIds.map((id) => [id, rows.filter((row) => row.slotId === id).map((row) => row.id)]),
      );
    }

    async function unchanged(
      label: string,
      send: () => PromiseLike<request.Response>,
      status: number,
      code: string,
    ): Promise<void> {
      const before = await world();
      const response = await expectStatus(send(), status, label);
      assert.equal(field(response.body as unknown, 'code'), code, label);
      assert.deepEqual(await world(), before, `${label} changed a booking, slot or request`);
      pass(`${label} → ${status} ${code}; bookings, slots and requests unchanged`);
    }

    /** Approval moves only the booking's slot, closes the request once and frees the old slot. */
    async function assertApproved(
      item: Fixture,
      requestId: string,
      targetSlotId: string,
      approver: Actor,
      body: unknown,
      before: World,
    ): Promise<void> {
      const after = await world();
      const previous = before.bookings.find((row) => row.id === item.bookingId);
      const moved = after.bookings.find((row) => row.id === item.bookingId);
      assert.ok(previous && moved);
      assert.equal(moved.slotId, targetSlotId);
      assert.deepEqual(
        { ...moved, slotId: previous.slotId, updatedAt: previous.updatedAt },
        previous,
        'Approval changed booking fields other than the slot',
      );
      const closed = after.requests.find((row) => row.id === requestId);
      assert.ok(closed);
      assert.equal(closed.status, RescheduleRequestStatus.APPROVED);
      assert.equal(closed.reviewedById, approver.id);
      assert.ok(closed.decidedAt instanceof Date);
      assert.equal(closed.withdrawnAt, null);
      assert.deepEqual(after.slots, before.slots, 'Approval must not edit AvailabilitySlot rows');
      assert.deepEqual(
        after.bookings.filter((row) => row.id !== item.bookingId),
        before.bookings.filter((row) => row.id !== item.bookingId),
      );
      assert.deepEqual(
        after.requests.filter((row) => row.id !== requestId),
        before.requests.filter((row) => row.id !== requestId),
      );
      assert.deepEqual(await activeHolders([item.slotId, targetSlotId]), {
        [item.slotId]: [],
        [targetSlotId]: [item.bookingId],
      });
      assert.equal(field(body, 'requestId'), requestId);
      assert.equal(field(body, 'status'), RescheduleRequestStatus.APPROVED);
      assert.equal(field(field(body, 'booking'), 'slotId'), targetSlotId);
      assert.equal(field(field(body, 'newSlot'), 'id'), targetSlotId);
    }

    /** Rejection or withdrawal closes only the request: no booking or slot changes. */
    async function assertClosed(
      requestId: string,
      before: World,
      status: RescheduleRequestStatus,
      reviewerId: string | null,
    ): Promise<void> {
      const after = await world();
      assert.deepEqual(after.bookings, before.bookings, 'Closing a request moved a booking');
      assert.deepEqual(after.slots, before.slots, 'Closing a request edited a slot');
      const previous = before.requests.find((row) => row.id === requestId);
      const closed = after.requests.find((row) => row.id === requestId);
      assert.ok(previous && closed);
      assert.equal(previous.status, RescheduleRequestStatus.PENDING);
      assert.equal(closed.status, status);
      assert.equal(closed.reviewedById, reviewerId);
      if (status === RescheduleRequestStatus.WITHDRAWN) {
        assert.ok(closed.withdrawnAt instanceof Date);
        assert.equal(closed.decidedAt, null);
      } else {
        assert.ok(closed.decidedAt instanceof Date);
        assert.equal(closed.withdrawnAt, null);
      }
      assert.deepEqual(
        {
          ...closed,
          status: previous.status,
          reviewedById: previous.reviewedById,
          decidedAt: previous.decidedAt,
          withdrawnAt: previous.withdrawnAt,
        },
        previous,
        'Closing a request changed its identity fields',
      );
      assert.deepEqual(
        after.requests.filter((row) => row.id !== requestId),
        before.requests.filter((row) => row.id !== requestId),
      );
    }

    // 1. The 24-hour cutoff when requesting, with the process clock frozen.
    for (const [label, lead, expected] of [
      ['exactly 24 hours', DAY_MS, 201],
      ['24 hours and 1 second', DAY_MS + SECOND_MS, 201],
      ['24 hours minus 1 second', DAY_MS - SECOND_MS, 409],
    ] as const) {
      const at = nextInstant();
      const item = await fixture(BookingStatus.CONFIRMED, new Date(at + lead), 1);
      const targetSlotId = await slot();
      if (expected === 409) {
        await unchanged(
          `request for a class ${label} away (clock frozen)`,
          () => frozenAt(at, () => requestReschedule(item.bookingId, student, targetSlotId)),
          409,
          'RESCHEDULE_CUTOFF_EXCEEDED',
        );
        continue;
      }
      const before = await world();
      const response = await expectStatus(
        frozenAt(at, () => requestReschedule(item.bookingId, student, targetSlotId)),
        201,
        `request for a class ${label} away`,
      );
      const requestId = field(response.body as unknown, 'requestId');
      assert.ok(typeof requestId === 'string');
      assert.deepEqual(response.body as unknown, {
        bookingId: item.bookingId,
        requestId,
        status: RescheduleRequestStatus.PENDING,
        targetSlotId,
      });
      const row = await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: requestId } });
      assert.equal(row.status, RescheduleRequestStatus.PENDING);
      assert.equal(row.requestedById, student.id);
      assert.equal(row.fromSlotId, item.slotId);
      assert.equal(row.requestedSlotId, targetSlotId);
      assert.equal(row.reason, DEFAULT_RESCHEDULE_REASON);
      const after = await world();
      assert.deepEqual(
        after.bookings,
        before.bookings,
        'A pending request must not move a booking',
      );
      assert.deepEqual(after.slots, before.slots);
      assert.deepEqual(await activeHolders([targetSlotId]), { [targetSlotId]: [] });
      pass(
        `request for a class ${label} away (clock frozen) → 201 pending; ` +
          'booking unchanged and target not held',
      );
    }

    for (const [label, lead] of [
      ['2 hours away', 2 * HOUR_MS],
      ['that already started', -30 * 60 * 1000],
    ] as const) {
      const item = await fixture(BookingStatus.CONFIRMED, new Date(Date.now() + lead), 1);
      const targetSlotId = await slot();
      await unchanged(
        `request for a class ${label}`,
        () => requestReschedule(item.bookingId, student, targetSlotId),
        409,
        'RESCHEDULE_CUTOFF_EXCEEDED',
      );
    }

    // 2. The same cutoff when approving: the booking's class time decides, not the request's age.
    for (const [label, lead, expected] of [
      ['exactly 24 hours', DAY_MS, 200],
      ['24 hours and 1 second', DAY_MS + SECOND_MS, 200],
      ['24 hours minus 1 second', DAY_MS - SECOND_MS, 409],
    ] as const) {
      const at = nextInstant();
      const item = await fixture(BookingStatus.CONFIRMED, new Date(at + lead), 1);
      const targetSlotId = await slot();
      const requestId = await pendingRequest(item, targetSlotId);
      if (expected === 409) {
        await unchanged(
          `approval for a class ${label} away (clock frozen)`,
          () => frozenAt(at, () => decide('approve', requestId, tutor)),
          409,
          'RESCHEDULE_CUTOFF_EXCEEDED',
        );
        continue;
      }
      const before = await world();
      const response = await expectStatus(
        frozenAt(at, () => decide('approve', requestId, tutor)),
        200,
        `approval for a class ${label} away`,
      );
      await assertApproved(item, requestId, targetSlotId, tutor, response.body as unknown, before);
      const closed = await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: requestId } });
      assert.equal(closed.decidedAt?.getTime(), at, 'decidedAt is the frozen approval time');
      pass(
        `approval for a class ${label} away (clock frozen) → 200; booking moved, request ` +
          'approved once, old slot freed',
      );
    }

    // 3. Target rules when requesting. Each rejection leaves every fixture row unchanged.
    const pastTarget = await slot(new Date(Date.now() - 2 * HOUR_MS), tutor.id, 1);
    const otherTutorTarget = await slot(undefined, otherTutor.id);
    const deletedTarget = await slot();
    await prisma.availabilitySlot.update({
      where: { id: deletedTarget },
      data: { deletedAt: new Date() },
    });
    const pendingHeldTarget = await slot();
    await addBooking(pendingHeldTarget, BookingStatus.PENDING, otherStudent.id);
    const confirmedHeldTarget = await slot();
    await addBooking(confirmedHeldTarget, BookingStatus.CONFIRMED, otherStudent.id);
    for (const [label, targetSlotId, status, code] of [
      ['its own current slot', undefined, 400, 'RESCHEDULE_SLOT_OVERLAP'],
      ['a slot that already started', pastTarget, 400, 'RESCHEDULE_TARGET_PAST'],
      ["another tutor's slot", otherTutorTarget, 400, 'RESCHEDULE_WRONG_TUTOR'],
      ['a deleted slot', deletedTarget, 409, 'RESCHEDULE_TARGET_UNAVAILABLE'],
      ['a slot held by a pending booking', pendingHeldTarget, 409, 'RESCHEDULE_TARGET_RESERVED'],
      [
        'a slot held by a confirmed booking',
        confirmedHeldTarget,
        409,
        'RESCHEDULE_TARGET_RESERVED',
      ],
      ['a slot that does not exist', randomUUID(), 404, 'SLOT_NOT_FOUND'],
      ['a malformed slot ID', 'not-a-uuid', 400, 'VALIDATION_FAILED'],
    ] as const) {
      const item = await fixture();
      await unchanged(
        `request targeting ${label}`,
        () => requestReschedule(item.bookingId, student, targetSlotId ?? item.slotId),
        status,
        code,
      );
    }

    {
      const item = await fixture();
      const freedTarget = await slot();
      await addBooking(freedTarget, BookingStatus.CANCELED, otherStudent.id);
      await expectStatus(
        requestReschedule(item.bookingId, student, freedTarget),
        201,
        'request targeting a slot whose only booking was canceled',
      );
      pass('request targeting a slot whose only booking was canceled → 201; it is available');
    }

    // "Overlapping" targets: a second live slot of the same tutor that partly overlaps the booked
    // one cannot exist, so the only reachable overlap is the booking's own slot (checked above).
    {
      const item = await fixture();
      const before = await world();
      const booked = before.slots.find((row) => row.id === item.slotId);
      assert.ok(booked);
      const overlapId = randomUUID();
      let refusal: unknown;
      try {
        await prisma.availabilitySlot.create({
          data: {
            id: overlapId,
            tutorProfileId: tutor.id,
            startAtUtc: new Date(booked.startAtUtc.getTime() + 30 * 60 * 1000),
            endAtUtc: new Date(booked.endAtUtc.getTime() + 30 * 60 * 1000),
          },
        });
        created.slots.push(overlapId);
      } catch (error) {
        refusal = error;
      }
      assert.ok(refusal, 'PostgreSQL must refuse a live slot overlapping the booked one');
      const detail = refusal instanceof Error ? refusal.message : JSON.stringify(refusal);
      assert.match(detail, /AvailabilitySlot_no_overlap_excl|23P01|exclusion/i, detail);
      assert.deepEqual(await world(), before);
      pass(
        'a same-tutor slot partly overlapping the booked slot is refused by ' +
          'AvailabilitySlot_no_overlap_excl, so it can never be a target',
      );
    }

    // 4. Only a confirmed booking can be rescheduled.
    for (const status of [
      BookingStatus.PENDING,
      BookingStatus.CANCELED,
      BookingStatus.COMPLETED,
      BookingStatus.EXPIRED,
    ]) {
      const item = await fixture(status);
      const targetSlotId = await slot();
      await unchanged(
        `request on a booking that is ${status}`,
        () => requestReschedule(item.bookingId, student, targetSlotId),
        409,
        'BOOKING_NOT_CONFIRMED',
      );
    }

    // 5. One pending request per booking; a closed request makes room for a new one.
    {
      const item = await fixture();
      const firstTarget = await slot();
      const secondTarget = await slot();
      await expectStatus(
        requestReschedule(item.bookingId, student, firstTarget),
        201,
        'first request',
      );
      for (const [label, requester] of [
        ['student', student],
        ['tutor', tutor],
      ] as const) {
        await unchanged(
          `a second request by the ${label} while one is pending`,
          () => requestReschedule(item.bookingId, requester, secondTarget),
          409,
          'RESCHEDULE_REQUEST_ALREADY_PENDING',
        );
      }
      const pendingId = async () =>
        (
          await prisma.rescheduleRequest.findFirstOrThrow({
            where: { bookingId: item.bookingId, status: RescheduleRequestStatus.PENDING },
          })
        ).id;
      await expectStatus(decide('withdraw', await pendingId(), student), 200, 'withdrawal');
      await expectStatus(
        requestReschedule(item.bookingId, student, secondTarget),
        201,
        'request after a withdrawal',
      );
      pass('after a withdrawal the booking accepts a new request');
      await expectStatus(decide('reject', await pendingId(), tutor), 200, 'rejection');
      await expectStatus(
        requestReschedule(item.bookingId, student, firstTarget),
        201,
        'request after a rejection',
      );
      pass('after a rejection the booking accepts a new request');
    }

    // 6. Unauthorized actions. Each one leaves every fixture row unchanged.
    {
      const item = await fixture();
      const targetSlotId = await slot();
      for (const [label, user, status, code] of [
        ['another student', otherStudent, 403, 'BOOKING_NOT_PARTICIPANT'],
        ['another tutor', otherTutor, 403, 'BOOKING_NOT_PARTICIPANT'],
        ['an admin', admin, 403, 'BOOKING_NOT_PARTICIPANT'],
        ['a caller without a token', undefined, 401, 'UNAUTHENTICATED'],
      ] as const) {
        await unchanged(
          `request by ${label}`,
          () => requestReschedule(item.bookingId, user, targetSlotId),
          status,
          code,
        );
      }
      await unchanged(
        'request on a booking that does not exist',
        () => requestReschedule(randomUUID(), student, targetSlotId),
        404,
        'BOOKING_NOT_FOUND',
      );
      await unchanged(
        'request on a malformed booking ID',
        () => requestReschedule('not-a-uuid', student, targetSlotId),
        400,
        'INVALID_UUID',
      );

      const requestId = await pendingRequest(item, targetSlotId);
      const decisions: Array<[string, Decision, Actor | undefined, number, string]> = [
        [
          'the student approving their own request',
          'approve',
          student,
          403,
          'RESCHEDULE_NOT_APPROVER',
        ],
        [
          'the student rejecting their own request',
          'reject',
          student,
          403,
          'RESCHEDULE_NOT_REVIEWER',
        ],
        [
          "the tutor withdrawing the student's request",
          'withdraw',
          tutor,
          403,
          'RESCHEDULE_NOT_REQUESTER',
        ],
        ['approving the request without a token', 'approve', undefined, 401, 'UNAUTHENTICATED'],
      ];
      for (const [label, outsider] of [
        ['another student', otherStudent],
        ['another tutor', otherTutor],
        ['an admin', admin],
      ] as const) {
        for (const action of ['approve', 'reject', 'withdraw'] as const) {
          decisions.push([
            `${label} trying to ${action} the request`,
            action,
            outsider,
            403,
            'BOOKING_NOT_PARTICIPANT',
          ]);
        }
      }
      for (const [label, action, user, status, code] of decisions) {
        await unchanged(label, () => decide(action, requestId, user), status, code);
      }
      await unchanged(
        'approving a request that does not exist',
        () => decide('approve', randomUUID(), tutor),
        404,
        'RESCHEDULE_REQUEST_NOT_FOUND',
      );
      await unchanged(
        'approving a malformed request ID',
        () => decide('approve', 'not-a-uuid', tutor),
        400,
        'INVALID_UUID',
      );
    }

    // 7. Successful decisions.
    {
      const item = await fixture();
      const targetSlotId = await slot();
      const requestId = await pendingRequest(item, targetSlotId);
      const before = await world();
      const response = await expectStatus(
        decide('approve', requestId, tutor),
        200,
        'tutor approval',
      );
      await assertApproved(item, requestId, targetSlotId, tutor, response.body as unknown, before);
      pass('the tutor approves the student request → 200; booking moved, request approved once');
      const rebooked = await book(item.slotId, otherStudent);
      assert.deepEqual(await activeHolders([item.slotId]), { [item.slotId]: [rebooked] });
      pass("the released original slot accepts another student's booking through the booking API");
      for (const [label, action, user] of [
        ['approving it again', 'approve', tutor],
        ['rejecting it', 'reject', tutor],
        ['withdrawing it', 'withdraw', student],
      ] as const) {
        await unchanged(
          `${label} after approval`,
          () => decide(action, requestId, user),
          409,
          'RESCHEDULE_REQUEST_NOT_PENDING',
        );
      }
    }

    {
      const item = await fixture();
      const targetSlotId = await slot();
      const createdRequest = await expectStatus(
        requestReschedule(item.bookingId, tutor, targetSlotId),
        201,
        'tutor request',
      );
      const requestId = field(createdRequest.body as unknown, 'requestId');
      assert.ok(typeof requestId === 'string');
      const before = await world();
      const response = await expectStatus(
        decide('approve', requestId, student),
        200,
        'student approval',
      );
      await assertApproved(
        item,
        requestId,
        targetSlotId,
        student,
        response.body as unknown,
        before,
      );
      pass(
        'the tutor requests and the student approves → 200; booking moved, request approved once',
      );
    }

    {
      const item = await fixture();
      const targetSlotId = await slot();
      const requestId = await pendingRequest(item, targetSlotId);
      const before = await world();
      const response = await expectStatus(
        post(`reschedule-requests/${requestId}/reject`, tutor, { reason: 'Not available then' }),
        200,
        'tutor rejection',
      );
      await assertClosed(requestId, before, RescheduleRequestStatus.REJECTED, tutor.id);
      const closed = await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: requestId } });
      assert.deepEqual(response.body as unknown, {
        requestId,
        reviewedAt: closed.decidedAt?.toISOString(),
        status: RescheduleRequestStatus.REJECTED,
      });
      pass('the tutor rejects → 200; request rejected, booking and slots unchanged');
      const taken = await book(targetSlotId, otherStudent);
      assert.deepEqual(await activeHolders([targetSlotId]), { [targetSlotId]: [taken] });
      pass('after a rejection the target stays bookable: another student books it');
      await unchanged(
        'approving the rejected request',
        () => decide('approve', requestId, tutor),
        409,
        'RESCHEDULE_REQUEST_NOT_PENDING',
      );
    }

    {
      const item = await fixture();
      const targetSlotId = await slot();
      const requestId = await pendingRequest(item, targetSlotId);
      const before = await world();
      const response = await expectStatus(
        decide('withdraw', requestId, student),
        200,
        'student withdrawal',
      );
      await assertClosed(requestId, before, RescheduleRequestStatus.WITHDRAWN, null);
      const closed = await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: requestId } });
      assert.deepEqual(response.body as unknown, {
        requestId,
        status: RescheduleRequestStatus.WITHDRAWN,
        withdrawnAt: closed.withdrawnAt?.toISOString(),
      });
      pass('the student withdraws → 200; request withdrawn, booking and slots unchanged');
      await unchanged(
        'approving the withdrawn request',
        () => decide('approve', requestId, tutor),
        409,
        'RESCHEDULE_REQUEST_NOT_PENDING',
      );
    }

    // 8. The target changes after the request. A pending request never holds its target, so the
    // server re-checks it at approval and the original booking keeps its slot.
    {
      const item = await fixture();
      const targetSlotId = await slot();
      const requestId = await pendingRequest(item, targetSlotId);
      const intruder = await book(targetSlotId, otherStudent);
      await unchanged(
        'approval after another student booked the target',
        () => decide('approve', requestId, tutor),
        409,
        'RESCHEDULE_TARGET_RESERVED',
      );
      assert.deepEqual(await activeHolders([item.slotId, targetSlotId]), {
        [item.slotId]: [item.bookingId],
        [targetSlotId]: [intruder],
      });
      const before = await world();
      await expectStatus(decide('reject', requestId, tutor), 200, 'rejecting the stale request');
      await assertClosed(requestId, before, RescheduleRequestStatus.REJECTED, tutor.id);
      pass('the tutor can still reject that request; the original booking keeps its slot');
    }

    {
      const item = await fixture();
      const targetSlotId = await slot();
      const requestId = await pendingRequest(item, targetSlotId);
      await prisma.availabilitySlot.update({
        where: { id: targetSlotId },
        data: { deletedAt: new Date() },
      });
      await unchanged(
        'approval after the target slot was deleted',
        () => decide('approve', requestId, tutor),
        409,
        'RESCHEDULE_TARGET_UNAVAILABLE',
      );
    }

    {
      const at = nextInstant();
      const targetSlotId = await slot(new Date(at), tutor.id, 1);
      const item = await fixture(BookingStatus.CONFIRMED, new Date(at + 2 * DAY_MS), 1);
      const requestId = await pendingRequest(item, targetSlotId);
      await unchanged(
        'approval after the target slot started (clock frozen)',
        () => frozenAt(at + SECOND_MS, () => decide('approve', requestId, tutor)),
        400,
        'RESCHEDULE_TARGET_PAST',
      );
    }

    // 9. Approval racing another student's booking of the same target slot, in both orders. Both
    // services lock the target's AvailabilitySlot row. A control transaction holds that lock; the
    // first request is seen waiting on it before the second starts, so PostgreSQL grants the lock
    // in that order once the control transaction commits.
    async function slotLockWaiters(): Promise<number> {
      const result = await control.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query LIKE '%FROM "AvailabilitySlot"%FOR UPDATE%'`,
      );
      return result.rows[0]?.count ?? 0;
    }

    async function waitForSlotLockWaiters(count: number, label: string): Promise<void> {
      const deadline = Date.now() + 5000;
      while ((await slotLockWaiters()) < count) {
        assert.ok(Date.now() < deadline, `${label} must wait for the target slot's row lock`);
        await delay(20);
      }
    }

    for (const first of ['approval', 'booking'] as const) {
      const item = await fixture();
      const targetSlotId = await slot();
      const requestId = await pendingRequest(item, targetSlotId);
      const before = await world();
      const blocker = await control.connect();
      const jobs: Array<Promise<request.Response>> = [];
      let holdingLock = false;
      try {
        await blocker.query('BEGIN');
        holdingLock = true;
        await blocker.query('SELECT "id" FROM "AvailabilitySlot" WHERE "id" = $1 FOR UPDATE', [
          targetSlotId,
        ]);
        const start = (job: 'approval' | 'booking'): void => {
          const call =
            job === 'approval'
              ? decide('approve', requestId, tutor)
              : post('bookings', otherStudent, { listingId, slotId: targetSlotId });
          const response = call.then((result) => result);
          void response.catch(() => {});
          jobs.push(response);
        };
        start(first);
        await waitForSlotLockWaiters(1, `The ${first}`);
        start(first === 'approval' ? 'booking' : 'approval');
        await waitForSlotLockWaiters(2, 'Both requests');
        await blocker.query('COMMIT');
        holdingLock = false;
        const [firstResponse, secondResponse] = await Promise.all(jobs);
        assert.ok(firstResponse && secondResponse);
        const [approval, booking] =
          first === 'approval' ? [firstResponse, secondResponse] : [secondResponse, firstResponse];

        if (first === 'approval') {
          assert.equal(approval.status, 200, `approval: ${JSON.stringify(approval.body)}`);
          assert.equal(booking.status, 409, `booking: ${JSON.stringify(booking.body)}`);
          assert.equal(field(booking.body as unknown, 'code'), 'CONFLICT');
          await assertApproved(
            item,
            requestId,
            targetSlotId,
            tutor,
            approval.body as unknown,
            before,
          );
        } else {
          assert.equal(booking.status, 201, `booking: ${JSON.stringify(booking.body)}`);
          assert.equal(approval.status, 409, `approval: ${JSON.stringify(approval.body)}`);
          assert.equal(field(approval.body as unknown, 'code'), 'RESCHEDULE_TARGET_RESERVED');
          const newBookingId = field(booking.body as unknown, 'id');
          assert.ok(typeof newBookingId === 'string');
          created.bookings.push(newBookingId);
          const after = await world();
          assert.deepEqual(
            after.bookings.filter((row) => row.id !== newBookingId),
            before.bookings,
            'The losing approval moved a booking',
          );
          assert.deepEqual(
            after.requests,
            before.requests,
            'The losing approval closed the request',
          );
          assert.deepEqual(after.slots, before.slots);
          assert.deepEqual(await activeHolders([item.slotId, targetSlotId]), {
            [item.slotId]: [item.bookingId],
            [targetSlotId]: [newBookingId],
          });
        }
        pass(
          `approval and another student's booking race for one target; the ${first} locks it ` +
            `first → ${first === 'approval' ? 'approval 200, booking 409' : 'booking 201, approval 409'}; ` +
            'exactly one booking holds the target',
        );
      } finally {
        if (holdingLock) {
          await blocker.query('ROLLBACK');
        }
        await Promise.allSettled(jobs);
        blocker.release();
      }
    }

    process.stdout.write(`Reschedule rules verification passed: ${passed} real-database checks\n`);
  } finally {
    try {
      // Only this invocation's random IDs are removed, including after a partially built fixture.
      await prisma.rescheduleRequest.deleteMany({ where: { bookingId: { in: created.bookings } } });
      await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
      await prisma.availabilitySlot.deleteMany({ where: { id: { in: created.slots } } });
      await prisma.teachingListing.deleteMany({ where: { id: { in: created.listings } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.studentProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
      await prisma.subject.deleteMany({ where: { id: { in: created.subjects } } });
      await prisma.gradeLevel.deleteMany({ where: { id: { in: created.grades } } });
    } finally {
      await app?.close();
      await prisma.$disconnect();
      await control.end();
      clock.uninstall();
    }
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : 'Reschedule rules verification failed'}\n`,
    );
    process.exitCode = 1;
  });
}

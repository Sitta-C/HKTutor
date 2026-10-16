import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import { BookingStatus, PaymentStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { AvailabilityState } from '@modules/tutors/tutors.dto';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

interface Fixture {
  bookingId: string;
  slotId: string;
}
interface Actor {
  id: string;
  role: Role;
  token: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SECOND_MS = 1000;
const NET_AMOUNT = '500.00';

// disposableDatabaseUrl and readGate mirror verify-tutor-booking-transitions.ts: each verifier
// stays self-contained, and scripts have no import alias to share them.

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

/** Holds the first of two racing reads until the second arrives, so both read before either writes. */
export function readGate(bookingId: string) {
  const control: { release?: () => void; reject?: (error: Error) => void } = {};
  const ready = new Promise<void>((resolve, reject) => {
    control.release = resolve;
    control.reject = reject;
  });
  void ready.catch(() => {});
  // This is a test synchronization timeout, not a booking time eligibility boundary.
  const timer = setTimeout(
    () => control.reject?.(new Error('Both service reads did not arrive')),
    5000,
  );
  return {
    bookingId,
    arrivals: 0,
    async arrive(): Promise<void> {
      this.arrivals += 1;
      if (this.arrivals === 2) {
        clearTimeout(timer);
        control.release?.();
      }
      await ready;
    },
    close(): void {
      clearTimeout(timer);
      control.release?.();
    },
  };
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
  const authConfig = new AuthConfigService(
    new ConfigService({
      JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      JWT_ISSUER: 'hktutor-s2-t24-verifier',
      JWT_AUDIENCE: 'hktutor-s2-t24-verifier',
    }),
  );
  const jwt = new JwtTokenService(authConfig);
  const created = {
    users: [] as string[],
    bookings: [] as string[],
    slots: [] as string[],
    listings: [] as string[],
    subjects: [] as string[],
    grades: [] as string[],
  };
  let app: INestApplication<App> | undefined;
  let gate: ReturnType<typeof readGate> | undefined;
  let commitOrder:
    | { second: 'cancel' | 'payment'; firstWrote: Promise<void>; releaseSecond: () => void }
    | undefined;
  let passed = 0;
  let slotSequence = 0;
  let referenceSequence = 0;

  function pass(label: string): void {
    passed += 1;
    process.stdout.write(`PASS [real PostgreSQL] ${label}\n`);
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

    // Holds both racing service reads until each has seen the same unpaid, confirmed booking.
    // Ownership guards select only the participant IDs, so they never reach the gate.
    const observedPrisma = prisma.$extends({
      query: {
        booking: {
          async findUnique({ args, query }) {
            const row = await query(args);
            const activeGate = gate;
            if (
              activeGate &&
              args.where.id === activeGate.bookingId &&
              args.select?.status === true
            ) {
              assert.equal(row?.status, BookingStatus.CONFIRMED, 'Racers must see CONFIRMED');
              assert.equal(row?.paymentStatus, PaymentStatus.UNPAID, 'Racers must see UNPAID');
              await activeGate.arrive();
            }
            return row;
          },
          // Fixes which racer writes first. The second writer waits after its stale read; the first
          // writer's update releases it while still uncommitted, so the second UPDATE queues on the
          // row lock and re-checks its UNPAID/state guard after the first commits.
          async updateMany({ args, query }) {
            const race = commitOrder;
            if (!race || args.where?.id !== gate?.bookingId) return query(args);
            const writer = args.data.status === BookingStatus.CANCELED ? 'cancel' : 'payment';
            if (writer === race.second) {
              await race.firstWrote;
              return query(args);
            }
            const result = await query(args);
            race.releaseSecond();
            return result;
          },
        },
      },
    });

    const module = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        BookingsService,
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        { provide: PrismaService, useValue: observedPrisma },
        { provide: JwtTokenService, useValue: jwt },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApplication(app);
    await app.init();
    const server = app.getHttpServer();
    const availability = new TutorAvailabilityService(prisma);

    async function actor(role: Role): Promise<Actor> {
      const id = randomUUID();
      created.users.push(id);
      await prisma.user.create({
        data: { id, email: `${id}@s2-t24.invalid`, role, emailVerifiedAt: new Date() },
      });
      if (role === Role.TUTOR) {
        await prisma.tutorProfile.create({
          data: {
            userId: id,
            displayName: 'Cancellation tester',
            bio: 'Synthetic fixture',
            experienceYears: 0,
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
        pricePerHour: NET_AMOUNT,
        description: 'Synthetic teaching listing for isolated booking cancellation verification.',
      },
    });

    // Two hours apart by default, so no two fixture slots of the tutor overlap.
    async function fixture(
      status: BookingStatus = BookingStatus.CONFIRMED,
      startAtUtc = new Date(Date.UTC(2099, 0, 1) + slotSequence++ * 2 * HOUR_MS),
      durationMs = HOUR_MS,
    ): Promise<Fixture> {
      const slotId = randomUUID();
      created.slots.push(slotId);
      await prisma.availabilitySlot.create({
        data: {
          id: slotId,
          tutorProfileId: tutor.id,
          startAtUtc,
          endAtUtc: new Date(startAtUtc.getTime() + durationMs),
        },
      });
      return addBooking(slotId, status);
    }

    async function addBooking(
      slotId: string,
      status: BookingStatus,
      studentId = student.id,
    ): Promise<Fixture> {
      const bookingId = randomUUID();
      created.bookings.push(bookingId);
      await prisma.booking.create({
        data: {
          id: bookingId,
          slotId,
          listingId,
          studentUserId: studentId,
          tutorProfileId: tutor.id,
          status,
          subtotalAmount: NET_AMOUNT,
          netAmount: NET_AMOUNT,
          ...(status === BookingStatus.CANCELED
            ? {
                canceledAt: new Date(),
                canceledById: tutor.id,
                cancellationReason: 'Original cancellation',
              }
            : {}),
        },
      });
      return { bookingId, slotId };
    }

    function cancel(item: Fixture, user: Actor | undefined, body: object): request.Test {
      const call = request(server)
        .post(`/api/v1/bookings/${item.bookingId}/cancel`)
        .send(body)
        .timeout({ response: 10_000, deadline: 15_000 });
      return user ? call.set('Authorization', `Bearer ${user.token}`) : call;
    }

    function pay(item: Fixture): request.Test {
      return request(server)
        .post(`/api/v1/bookings/me/${item.bookingId}/mock-payment`)
        .set('Authorization', `Bearer ${student.token}`)
        .send({ amount: NET_AMOUNT, reference: `S2-T24-${process.pid}-${referenceSequence++}` })
        .timeout({ response: 10_000, deadline: 15_000 });
    }

    async function snapshot(item: Fixture) {
      const [booking, slot, active] = await Promise.all([
        prisma.booking.findUniqueOrThrow({ where: { id: item.bookingId } }),
        prisma.availabilitySlot.findUniqueOrThrow({ where: { id: item.slotId } }),
        prisma.booking.findMany({
          where: {
            slotId: item.slotId,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
          select: { id: true, status: true },
          orderBy: { id: 'asc' },
        }),
      ]);
      const slots = await availability.getAvailabilityPrivate(tutor.id, {
        from: slot.startAtUtc,
        to: slot.endAtUtc,
      });
      const projected = slots.find((candidate) => candidate.id === item.slotId);
      assert.ok(projected, 'The private availability projection must include the slot');
      return { booking, slot, active, state: projected.state };
    }

    function errorCode(body: unknown): unknown {
      assert.ok(body && typeof body === 'object' && 'code' in body, 'Expected an error body');
      return body.code;
    }

    /** A rejected request must leave the booking, its payment fields and its slot exactly as before. */
    async function unchanged(
      label: string,
      item: Fixture,
      send: () => request.Test,
      status: number,
      code: string,
    ): Promise<void> {
      const before = await snapshot(item);
      const response = await send().expect(status);
      assert.equal(errorCode(response.body as unknown), code);
      assert.deepEqual(
        await snapshot(item),
        before,
        'A rejected cancellation changed the booking, payment or slot',
      );
      pass(`${label} → ${status} ${code}; booking, payment and slot unchanged`);
    }

    /** The winner cancels once: only the cancellation fields change and the slot is released. */
    async function assertCanceled(
      item: Fixture,
      before: Awaited<ReturnType<typeof snapshot>>,
      body: unknown,
      canceler: Actor,
      reason: string,
    ): Promise<void> {
      const after = await snapshot(item);
      assert.equal(after.booking.status, BookingStatus.CANCELED);
      assert.ok(after.booking.canceledAt instanceof Date);
      assert.equal(after.booking.canceledById, canceler.id);
      assert.equal(after.booking.cancellationReason, reason);
      assert.deepEqual(
        {
          ...after.booking,
          status: before.booking.status,
          updatedAt: before.booking.updatedAt,
          canceledAt: before.booking.canceledAt,
          canceledById: before.booking.canceledById,
          cancellationReason: before.booking.cancellationReason,
        },
        before.booking,
        'Cancellation changed unrelated booking or payment fields',
      );
      assert.equal(after.booking.paymentStatus, PaymentStatus.UNPAID);
      assert.deepEqual(after.slot, before.slot, 'Cancellation must keep the AvailabilitySlot row');
      assert.deepEqual(after.active, [], 'The canceled booking must stop holding the slot');
      assert.equal(after.state, AvailabilityState.OPEN);
      assert.deepEqual(
        body,
        {
          bookingId: item.bookingId,
          status: BookingStatus.CANCELED,
          canceledAt: after.booking.canceledAt.toISOString(),
        },
        'The API must report the persisted cancellation',
      );
    }

    // The 24-hour cutoff at exact boundaries, with the process clock frozen at `now`.
    // One-millisecond slots keep the three boundary slots from overlapping.
    const now = Math.floor(Date.now() / SECOND_MS) * SECOND_MS + 5 * SECOND_MS;
    for (const [label, lead, expected] of [
      ['exactly 24 hours', DAY_MS, 200],
      ['24 hours and 1 second', DAY_MS + SECOND_MS, 200],
      ['24 hours minus 1 second', DAY_MS - SECOND_MS, 409],
    ] as const) {
      const item = await fixture(BookingStatus.CONFIRMED, new Date(now + lead), 1);
      const before = await snapshot(item);
      clock.freeze(now);
      let response: request.Response;
      try {
        response = await cancel(item, student, { reason: '  School event  ' });
      } finally {
        clock.release();
      }
      assert.equal(response.status, expected, `${label}: unexpected HTTP status`);
      if (expected === 200) {
        await assertCanceled(item, before, response.body as unknown, student, 'School event');
        const after = await snapshot(item);
        assert.equal(after.booking.canceledAt?.getTime(), now, 'canceledAt is the frozen time');
        pass(`class in ${label} (clock frozen) → 200, canceled once and slot released`);
      } else {
        assert.equal(errorCode(response.body as unknown), 'BOOKING_EXCEED_CANCEL_RANGE');
        assert.deepEqual(await snapshot(item), before, `${label} changed persisted rows`);
        pass(`class in ${label} (clock frozen) → 409; booking, payment and slot unchanged`);
      }
    }

    for (const [label, lead] of [
      ['2 hours, as in US5-1', 2 * HOUR_MS],
      ['the past', -HOUR_MS],
    ] as const) {
      const item = await fixture(BookingStatus.CONFIRMED, new Date(Date.now() + lead));
      await unchanged(
        `class starting in ${label}`,
        item,
        () => cancel(item, student, { reason: 'School event' }),
        409,
        'BOOKING_EXCEED_CANCEL_RANGE',
      );
    }

    // Successful cancellations by each participant, including a pending booking as the API allows.
    for (const [label, status, canceler] of [
      ['student cancels a confirmed booking', BookingStatus.CONFIRMED, student],
      ['tutor cancels a confirmed booking', BookingStatus.CONFIRMED, tutor],
      ['student cancels a pending booking', BookingStatus.PENDING, student],
    ] as const) {
      const item = await fixture(status);
      const before = await snapshot(item);
      const response = await cancel(item, canceler, { reason: 'Schedule conflict' }).expect(200);
      await assertCanceled(item, before, response.body as unknown, canceler, 'Schedule conflict');
      pass(`${label} → 200, canceled once by that participant and slot released`);
    }

    // Released once: the freed slot takes a new booking, and the old cancellation cannot touch it.
    {
      const item = await fixture();
      await cancel(item, student, { reason: 'School event' }).expect(200);
      const replacement = await addBooking(item.slotId, BookingStatus.PENDING, otherStudent.id);
      const held = await snapshot(replacement);
      assert.deepEqual(held.active, [{ id: replacement.bookingId, status: BookingStatus.PENDING }]);
      assert.equal(held.state, AvailabilityState.RESERVED);
      pass('the released slot accepts a new booking');
      await unchanged(
        'cancel the already-canceled booking again',
        item,
        () => cancel(item, student, { reason: 'Again' }),
        409,
        'BOOKING_ALREADY_CANCELED',
      );
      assert.deepEqual(await snapshot(replacement), held, 'The new booking must keep the slot');
      pass('a repeated cancellation leaves the new booking holding the slot');
    }

    for (const [label, body] of [
      ['a missing reason', {}],
      ['a blank reason', { reason: '   ' }],
      ['a reason that is not a string', { reason: 42 }],
    ] as const) {
      const item = await fixture();
      await unchanged(label, item, () => cancel(item, student, body), 400, 'VALIDATION_FAILED');
    }

    {
      const item = await fixture();
      await pay(item).expect(200);
      const paid = await snapshot(item);
      assert.equal(paid.booking.paymentStatus, PaymentStatus.PAID);
      await unchanged(
        'a booking paid through mock payment',
        item,
        () => cancel(item, student, { reason: 'School event' }),
        409,
        'BOOKING_ALREADY_PAID',
      );
    }

    for (const [label, status, code] of [
      ['a completed booking', BookingStatus.COMPLETED, 'BOOKING_ALREADY_COMPLETED'],
      ['a canceled booking', BookingStatus.CANCELED, 'BOOKING_ALREADY_CANCELED'],
      ['an expired booking', BookingStatus.EXPIRED, 'BOOKING_ALREADY_EXPIRED'],
    ] as const) {
      const item = await fixture(status);
      await unchanged(
        label,
        item,
        () => cancel(item, student, { reason: 'School event' }),
        409,
        code,
      );
    }

    for (const [label, user] of [
      ['another student', otherStudent],
      ['another tutor', otherTutor],
      ['an admin', admin],
    ] as const) {
      const item = await fixture();
      await unchanged(
        label,
        item,
        () => cancel(item, user, { reason: 'School event' }),
        403,
        'BOOKING_NOT_OWNED',
      );
    }
    {
      const item = await fixture();
      await unchanged(
        'no access token',
        item,
        () => cancel(item, undefined, { reason: 'School event' }),
        401,
        'UNAUTHENTICATED',
      );
    }
    for (const missingId of [randomUUID(), 'not-a-uuid']) {
      const malformed = missingId === 'not-a-uuid';
      const allRows = async () => ({
        bookings: await prisma.booking.findMany({
          where: { id: { in: created.bookings } },
          orderBy: { id: 'asc' },
        }),
        slots: await prisma.availabilitySlot.findMany({
          where: { id: { in: created.slots } },
          orderBy: { id: 'asc' },
        }),
      });
      const before = await allRows();
      const response = await cancel({ bookingId: missingId, slotId: '' }, student, {
        reason: 'School event',
      }).expect(malformed ? 400 : 404);
      assert.equal(
        errorCode(response.body as unknown),
        malformed ? 'INVALID_UUID' : 'BOOKING_NOT_FOUND',
      );
      assert.deepEqual(await allRows(), before, 'A failed lookup changed fixture rows');
      pass(`${malformed ? 'a malformed' : 'a missing'} booking ID changes no records`);
    }

    // Concurrent cancellation: both requests read the confirmed booking before either writes.
    {
      const item = await fixture();
      const before = await snapshot(item);
      gate = readGate(item.bookingId);
      try {
        const results = await Promise.all(
          [student, tutor].map((canceler) =>
            cancel(item, canceler, { reason: `Canceled by ${canceler.role}` }).then((response) => ({
              canceler,
              response,
            })),
          ),
        );
        assert.equal(gate.arrivals, 2, 'Both cancellations must read before either writes');
        assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409]);
        const winner = results.find(({ response }) => response.status === 200);
        const loser = results.find(({ response }) => response.status === 409);
        assert.ok(winner && loser);
        assert.equal(errorCode(loser.response.body as unknown), 'BOOKING_TRANSITION_CONFLICT');
        await assertCanceled(
          item,
          before,
          winner.response.body as unknown,
          winner.canceler,
          `Canceled by ${winner.canceler.role}`,
        );
        pass('student and tutor cancel at once → one 200, one 409, canceled and released once');
      } finally {
        gate.close();
        gate = undefined;
      }
    }

    // Cancellation racing a mock payment, once in each commit order. Both read the same unpaid,
    // confirmed booking; the second writer acts on that stale read and must lose with 409.
    for (const first of ['cancel', 'payment'] as const) {
      const item = await fixture();
      const before = await snapshot(item);
      let releaseSecond = (): void => {};
      const firstWrote = new Promise<void>((release) => {
        releaseSecond = release;
      });
      commitOrder = {
        second: first === 'cancel' ? 'payment' : 'cancel',
        firstWrote,
        releaseSecond,
      };
      gate = readGate(item.bookingId);
      try {
        const [canceled, paid] = await Promise.all([
          cancel(item, student, { reason: 'School event' }),
          pay(item),
        ]);
        const [winner, loser] = first === 'cancel' ? [canceled, paid] : [paid, canceled];
        assert.equal(gate.arrivals, 2, 'Cancel and payment must both read before either writes');
        assert.equal(winner.status, 200, `${first} should commit first`);
        assert.equal(loser.status, 409, 'The stale second writer must be rejected');
        const after = await snapshot(item);
        if (first === 'cancel') {
          assert.equal(errorCode(loser.body as unknown), 'BOOKING_PAYMENT_CONFLICT');
          await assertCanceled(item, before, winner.body as unknown, student, 'School event');
          assert.equal(after.booking.paidAt, null);
          assert.equal(after.booking.mockReference, null);
        } else {
          assert.equal(errorCode(loser.body as unknown), 'BOOKING_TRANSITION_CONFLICT');
          assert.equal(after.booking.status, BookingStatus.CONFIRMED);
          assert.equal(after.booking.paymentStatus, PaymentStatus.PAID);
          assert.equal(after.booking.canceledAt, null);
          assert.equal(after.booking.canceledById, null);
          assert.equal(after.booking.cancellationReason, null);
          assert.deepEqual(after.active, [{ id: item.bookingId, status: BookingStatus.CONFIRMED }]);
          assert.equal(after.state, AvailabilityState.RESERVED);
        }
        pass(
          `cancel and payment read the same unpaid booking, ${first} commits first → the other gets 409; never canceled and paid`,
        );
      } finally {
        releaseSecond();
        gate.close();
        gate = undefined;
        commitOrder = undefined;
      }
    }

    {
      const item = await fixture();
      await cancel(item, student, { reason: 'School event' }).expect(200);
      await unchanged(
        'mock payment after cancellation',
        item,
        () => pay(item),
        409,
        'BOOKING_NOT_PAYABLE',
      );
    }

    const inconsistent = await prisma.booking.count({
      where: {
        id: { in: created.bookings },
        paymentStatus: PaymentStatus.PAID,
        status: BookingStatus.CANCELED,
      },
    });
    assert.equal(inconsistent, 0, 'No booking may be both canceled and paid');
    pass('no fixture booking ended both canceled and paid');

    process.stdout.write(
      `Booking cancellation verification passed: ${passed} real-database checks\n`,
    );
  } finally {
    gate?.close();
    try {
      // Only this invocation's random IDs are removed, including after a partially built fixture.
      await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
      await prisma.availabilitySlot.deleteMany({ where: { id: { in: created.slots } } });
      await prisma.teachingListing.deleteMany({ where: { id: { in: created.listings } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
      await prisma.subject.deleteMany({ where: { id: { in: created.subjects } } });
      await prisma.gradeLevel.deleteMany({ where: { id: { in: created.grades } } });
    } finally {
      await app?.close();
      await prisma.$disconnect();
      clock.uninstall();
    }
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : 'Cancellation verification failed'}\n`,
    );
    process.exitCode = 1;
  });
}

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
import { BookingStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import {
  BookingSlotStatus,
  DEFAULT_BOOKINGS_PAGE_SIZE,
  MAX_BOOKINGS_PAGE_SIZE,
  MAX_TUTOR_ACTION_TEXT_LENGTH,
} from '@modules/bookings/bookings.dto';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { AvailabilityState } from '@modules/tutors/tutors.dto';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

type Action = 'confirm' | 'reject';
interface Fixture {
  bookingId: string;
  slotId: string;
}
interface Actor {
  id: string;
  token: string;
}

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

export function readGate(bookingId: string) {
  const control: { release?: () => void; reject?: (error: Error) => void } = {};
  const ready = new Promise<void>((resolve, reject) => {
    control.release = resolve;
    control.reject = reject;
  });
  // Observe early rejection even when neither service read reaches the gate. Later awaiters
  // still receive the rejection from the original promise, and main can run its cleanup.
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

async function main(): Promise<void> {
  const databaseUrl = disposableDatabaseUrl();
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const authConfig = new AuthConfigService(
    new ConfigService({
      JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
      JWT_ISSUER: 'hktutor-s2-t03-verifier',
      JWT_AUDIENCE: 'hktutor-s2-t03-verifier',
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
  let passed = 0;
  let slotSequence = 0;
  const actions: readonly Action[] = ['confirm', 'reject'];

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
    assert.equal(
      migrations.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
      'Resolve unfinished migrations before verification',
    );
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'Booking_active_slot_key'
    `;
    assert.equal(indexes.length, 1, 'Apply the committed booking migrations first');
    assert.match(indexes[0]?.indexdef ?? '', /UNIQUE.*slotId.*WHERE.*pending.*confirmed/);
    const cancellationChecks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = '"Booking"'::regclass AND conname = 'Booking_cancellation_fields_check'
    `;
    assert.equal(cancellationChecks.length, 1, 'The cancellation constraint must be installed');

    // The extension waits AFTER the actual SELECT and never replaces a database result or write.
    // Guards select ownership only; only the service SELECT includes status and reaches the gate.
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
              assert.equal(row?.status, BookingStatus.PENDING, 'Both racers must observe PENDING');
              await activeGate.arrive();
            }
            return row;
          },
        },
      },
    });
    const module = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        NotificationEventsService,
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
        data: { id, email: `${id}@s2-t03.invalid`, role, emailVerifiedAt: new Date() },
      });
      if (role === Role.TUTOR) {
        await prisma.tutorProfile.create({
          data: {
            userId: id,
            displayName: 'Transition tester',
            bio: 'Synthetic fixture',
            experienceYears: 0,
          },
        });
      }
      const session = await prisma.authSession.create({
        data: {
          userId: id,
          expiresAt: new Date(Date.now() + 60_000),
          refreshTokenHash: randomBytes(32).toString('hex'),
        },
      });
      return { id, token: jwt.signAccessToken(id, session.id, role) };
    }

    const owner = await actor(Role.TUTOR);
    const foreign = await actor(Role.TUTOR);
    const student = await actor(Role.STUDENT);
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
    // A DRAFT listing is sufficient: tutor decisions do not apply publishing/quote rules.
    await prisma.teachingListing.create({
      data: {
        id: listingId,
        tutorProfileId: owner.id,
        subjectId,
        gradeLevelId,
        pricePerHour: '500.00',
        description: 'Synthetic teaching listing for isolated booking transition verification.',
      },
    });

    async function fixture(
      status: BookingStatus = BookingStatus.PENDING,
      startAtUtc = new Date(Date.UTC(2099, 0, 1) + slotSequence++ * 7_200_000),
      durationMs = 3_600_000,
    ): Promise<Fixture> {
      const slotId = randomUUID();
      created.slots.push(slotId);
      await prisma.availabilitySlot.create({
        data: {
          id: slotId,
          tutorProfileId: owner.id,
          startAtUtc,
          endAtUtc: new Date(startAtUtc.getTime() + durationMs),
        },
      });
      return addBooking(slotId, status);
    }

    async function addBooking(slotId: string, status: BookingStatus): Promise<Fixture> {
      const bookingId = randomUUID();
      created.bookings.push(bookingId);
      await prisma.booking.create({
        data: {
          id: bookingId,
          slotId,
          listingId,
          studentUserId: student.id,
          tutorProfileId: owner.id,
          status,
          subtotalAmount: '500.00',
          netAmount: '500.00',
          ...(status === BookingStatus.CANCELED
            ? {
                canceledAt: new Date(),
                canceledById: owner.id,
                cancellationReason: 'Original cancellation',
              }
            : {}),
        },
      });
      return { bookingId, slotId };
    }

    function act(
      item: Fixture,
      action: Action,
      user: Actor = owner,
      body: object = {},
    ): request.Test {
      return request(server)
        .post(`/api/v1/bookings/tutor/${item.bookingId}/${action}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body)
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
      const slots = await availability.getAvailabilityPrivate(owner.id, {
        from: slot.startAtUtc,
        to: slot.endAtUtc,
      });
      const projected = slots.find((slot) => slot.id === item.slotId);
      assert.ok(projected, 'The private availability projection must include the slot');
      return { booking, slot, active, state: projected.state };
    }

    async function unchanged(
      item: Fixture,
      action: Action,
      user: Actor,
      status: number,
      code: string,
      body: object = {},
    ): Promise<void> {
      const before = await snapshot(item);
      const response = await act(item, action, user, body).expect(status);
      const responseBody: unknown = response.body;
      assert.ok(responseBody && typeof responseBody === 'object' && 'code' in responseBody);
      assert.equal(responseBody.code, code);
      assert.deepEqual(
        await snapshot(item),
        before,
        'A failed request changed persisted booking/slot/availability',
      );
      pass(`${action} ${status}/${code} preserves full snapshots`);
    }

    async function assertWinner(
      item: Fixture,
      action: Action,
      body: unknown,
      before: Awaited<ReturnType<typeof snapshot>>,
      expectedReason = 'Rejected by the tutor',
    ): Promise<void> {
      const after = await snapshot(item);
      assert.equal(
        after.booking.status,
        action === 'confirm' ? BookingStatus.CONFIRMED : BookingStatus.CANCELED,
      );
      assert.deepEqual(after.slot, before.slot, 'Decisions must preserve the AvailabilitySlot row');
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
        'A decision changed unrelated booking fields',
      );
      if (action === 'confirm') {
        assert.equal(after.booking.canceledAt, null);
        assert.equal(after.booking.canceledById, null);
        assert.equal(after.booking.cancellationReason, null);
        assert.deepEqual(after.active, [{ id: item.bookingId, status: BookingStatus.CONFIRMED }]);
        assert.equal(after.state, AvailabilityState.RESERVED);
      } else {
        assert.ok(after.booking.canceledAt instanceof Date);
        assert.equal(after.booking.canceledById, owner.id);
        assert.equal(after.booking.cancellationReason, expectedReason);
        assert.deepEqual(after.active, []);
        assert.equal(after.state, AvailabilityState.OPEN);
      }
      assert.deepEqual(
        body,
        {
          bookingId: item.bookingId,
          status: after.booking.status,
          canceledAt: after.booking.canceledAt?.toISOString() ?? null,
          slotStatus:
            action === 'confirm' ? BookingSlotStatus.RESERVED : BookingSlotStatus.AVAILABLE,
        },
        'The API must report the persisted winner',
      );
    }

    for (const action of actions) {
      for (const denied of [student, admin]) {
        await unchanged(await fixture(), action, denied, 403, 'FORBIDDEN');
      }
      for (const status of [BookingStatus.PENDING, BookingStatus.CONFIRMED]) {
        await unchanged(await fixture(status), action, foreign, 403, 'BOOKING_NOT_OWNED');
      }
      for (const status of [
        BookingStatus.CONFIRMED,
        BookingStatus.COMPLETED,
        BookingStatus.CANCELED,
        BookingStatus.EXPIRED,
      ]) {
        await unchanged(await fixture(status), action, owner, 409, 'BOOKING_NOT_PENDING');
      }
      const field = action === 'confirm' ? 'note' : 'reason';
      for (const body of [
        { [field]: 'x'.repeat(MAX_TUTOR_ACTION_TEXT_LENGTH + 1) },
        { [field]: '' },
        { [field]: 42 },
        { tutorUserId: foreign.id },
      ]) {
        await unchanged(await fixture(), action, owner, 400, 'VALIDATION_FAILED', body);
      }
      for (const length of [MAX_TUTOR_ACTION_TEXT_LENGTH - 1, MAX_TUTOR_ACTION_TEXT_LENGTH]) {
        const item = await fixture();
        const before = await snapshot(item);
        const text = 'x'.repeat(length);
        const response = await act(item, action, owner, { [field]: text }).expect(200);
        await assertWinner(item, action, response.body as unknown, before, text);
        pass(`${action} ${length} ASCII characters persists expected outcome`);
      }
      for (const missingId of [randomUUID(), 'not-a-uuid']) {
        const allOwnedRows = async () => ({
          bookings: await prisma.booking.findMany({
            where: { id: { in: created.bookings } },
            orderBy: { id: 'asc' },
          }),
          slots: await prisma.availabilitySlot.findMany({
            where: { id: { in: created.slots } },
            orderBy: { id: 'asc' },
          }),
        });
        const before = await allOwnedRows();
        const malformed = missingId === 'not-a-uuid';
        if (!malformed)
          assert.equal(await prisma.booking.findUnique({ where: { id: missingId } }), null);
        const response = await act({ bookingId: missingId, slotId: '' }, action).expect(
          malformed ? 400 : 404,
        );
        const body: unknown = response.body;
        assert.ok(body && typeof body === 'object' && 'code' in body);
        assert.equal(body.code, malformed ? 'INVALID_UUID' : 'BOOKING_NOT_FOUND');
        assert.deepEqual(
          await allOwnedRows(),
          before,
          'Failed ID lookup must not change any owned fixture rows',
        );
        if (!malformed)
          assert.equal(await prisma.booking.findUnique({ where: { id: missingId } }), null);
        pass(
          `${action} ${missingId === 'not-a-uuid' ? 'malformed' : 'missing'} ID preserves other records`,
        );
      }
    }

    for (const first of actions) {
      for (const second of actions) {
        const item = await fixture();
        const before = await snapshot(item);
        const winner = await act(item, first).expect(200);
        await assertWinner(item, first, winner.body as unknown, before);
        await unchanged(item, second, owner, 409, 'BOOKING_NOT_PENDING');
        pass(`${first} then ${second}: one success, second action cannot alter it`);
      }
    }

    for (const reason of [undefined, '  unavailable  ']) {
      const item = await fixture();
      const before = await snapshot(item);
      const response = await act(
        item,
        'reject',
        owner,
        reason === undefined ? {} : { reason },
      ).expect(200);
      await assertWinner(
        item,
        'reject',
        response.body as unknown,
        before,
        reason?.trim() ?? 'Rejected by the tutor',
      );
      pass(
        `reject ${reason === undefined ? 'omitted' : 'trimmed'} reason stored with actor and timestamp`,
      );
    }

    const historical = await fixture(BookingStatus.CANCELED);
    const replacement = await addBooking(historical.slotId, BookingStatus.PENDING);
    for (const action of actions) {
      await unchanged(historical, action, owner, 409, 'BOOKING_NOT_PENDING');
      const held = await snapshot(replacement);
      assert.equal(held.state, AvailabilityState.RESERVED);
      assert.deepEqual(held.active, [{ id: replacement.bookingId, status: BookingStatus.PENDING }]);
      pass(`${action} on historical cancellation does not release the replacement reservation`);
    }

    for (const pair of [
      ['confirm', 'confirm'],
      ['reject', 'reject'],
      ['confirm', 'reject'],
      ['reject', 'confirm'],
    ] as const) {
      const item = await fixture();
      const before = await snapshot(item);
      gate = readGate(item.bookingId);
      try {
        const results = await Promise.all(
          pair.map((action) => act(item, action).then((response) => ({ action, response }))),
        );
        assert.equal(gate.arrivals, 2, 'The test must force two actual PENDING service reads');
        assert.deepEqual(results.map(({ response }) => response.status).sort(), [200, 409]);
        const winner = results.find(({ response }) => response.status === 200);
        const loser = results.find(({ response }) => response.status === 409);
        assert.ok(winner && loser);
        const loserBody: unknown = loser.response.body;
        assert.ok(loserBody && typeof loserBody === 'object' && 'code' in loserBody);
        assert.equal(loserBody.code, 'BOOKING_TRANSITION_CONFLICT');
        await assertWinner(item, winner.action, winner.response.body as unknown, before);
        pass(`overlapping ${pair.join('+')}: one committed winner, loser leaves no partial write`);
      } finally {
        gate.close();
        gate = undefined;
      }
    }

    // One-millisecond non-overlapping slots isolate both inclusive filter boundaries without
    // borrowing the booking-create or cancellation eligibility rules from another task.
    const lower = Date.UTC(2100, 0, 1);
    const upper = lower + 10;
    const boundaryItems = await Promise.all(
      [-1, 0, 1, 9, 10, 11].map(async (offset) => ({
        ...(await fixture(BookingStatus.PENDING, new Date(lower + offset), 1)),
        offset,
      })),
    );
    const boundaryIds = new Set(boundaryItems.map((item) => item.bookingId));
    const expectedIds = (offsets: number[]) =>
      boundaryItems
        .filter((item) => offsets.includes(item.offset))
        .map((item) => item.bookingId)
        .sort();
    async function inbox(query: object, expectedStatus = 200): Promise<unknown> {
      const before = await prisma.booking.findMany({
        where: { id: { in: created.bookings } },
        orderBy: { id: 'asc' },
      });
      const slotsBefore = await prisma.availabilitySlot.findMany({
        where: { id: { in: created.slots } },
        orderBy: { id: 'asc' },
      });
      const response = await request(server)
        .get('/api/v1/bookings/tutor')
        .set('Authorization', `Bearer ${owner.token}`)
        .query(query)
        .expect(expectedStatus);
      assert.deepEqual(
        await prisma.booking.findMany({
          where: { id: { in: created.bookings } },
          orderBy: { id: 'asc' },
        }),
        before,
      );
      assert.deepEqual(
        await prisma.availabilitySlot.findMany({
          where: { id: { in: created.slots } },
          orderBy: { id: 'asc' },
        }),
        slotsBefore,
      );
      return response.body as unknown;
    }
    function inboxIds(body: unknown): string[] {
      assert.ok(body && typeof body === 'object' && 'items' in body && Array.isArray(body.items));
      return body.items.map((value: unknown) => {
        assert.ok(
          value && typeof value === 'object' && 'id' in value && typeof value.id === 'string',
        );
        return value.id;
      });
    }
    for (const [query, offsets] of [
      [{ from: new Date(lower).toISOString(), to: new Date(upper).toISOString() }, [0, 1, 9, 10]],
      [{ from: new Date(lower).toISOString() }, [0, 1, 9, 10, 11]],
      [{ to: new Date(upper).toISOString() }, [-1, 0, 1, 9, 10]],
      [{ from: new Date(lower).toISOString(), to: new Date(lower).toISOString() }, [0]],
    ] as const) {
      const ids = inboxIds(await inbox({ ...query, pageSize: MAX_BOOKINGS_PAGE_SIZE }))
        .filter((id) => boundaryIds.has(id))
        .sort();
      assert.deepEqual(ids, expectedIds([...offsets]));
      pass('inbox inclusive time boundary returns persisted IDs and changes no records');
    }
    for (const delta of [-1, 0, 1]) {
      await inbox(
        { from: new Date(lower + delta).toISOString(), to: new Date(lower).toISOString() },
        delta > 0 ? 400 : 200,
      );
      pass(`inbox from minus to ${delta} milliseconds`);
    }
    for (const [query, status] of [
      [{ page: 0 }, 400],
      [{ page: 1 }, 200],
      [{ page: 2 }, 200],
      [{ pageSize: 0 }, 400],
      [{ pageSize: 1 }, 200],
      [{ pageSize: 2 }, 200],
      [{ pageSize: MAX_BOOKINGS_PAGE_SIZE - 1 }, 200],
      [{ pageSize: MAX_BOOKINGS_PAGE_SIZE }, 200],
      [{ pageSize: MAX_BOOKINGS_PAGE_SIZE + 1 }, 400],
    ] as const) {
      const body = await inbox(query, status);
      if (status === 200) {
        const ids = inboxIds(body);
        const rows = await prisma.booking.findMany({
          where: { tutorProfileId: owner.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const page = 'page' in query ? query.page : 1;
        const size = 'pageSize' in query ? query.pageSize : DEFAULT_BOOKINGS_PAGE_SIZE;
        assert.deepEqual(
          ids,
          rows.slice((page - 1) * size, page * size).map((row) => row.id),
        );
        assert.ok(body && typeof body === 'object' && 'total' in body);
        assert.equal(body.total, rows.length);
      }
      pass(`inbox pagination ${JSON.stringify(query)} returns HTTP ${status} without writes`);
    }
    for (const status of Object.values(BookingStatus)) {
      const body = await inbox({ status, pageSize: MAX_BOOKINGS_PAGE_SIZE });
      const expected = await prisma.booking.findMany({
        where: { tutorProfileId: owner.id, status },
        select: { id: true },
      });
      assert.deepEqual(inboxIds(body).sort(), expected.map((row) => row.id).sort());
      pass(`inbox ${status} filter returns only persisted matching bookings`);
    }
    const emptyForeign = await request(server)
      .get('/api/v1/bookings/tutor')
      .set('Authorization', `Bearer ${foreign.token}`)
      .expect(200);
    assert.deepEqual(emptyForeign.body as unknown, { items: [], total: 0 });
    pass('foreign tutor inbox cannot disclose owner bookings');
    process.stdout.write(
      `Tutor booking transition verification passed: ${passed} real-database checks\n`,
    );
  } finally {
    gate?.close();
    try {
      // Only this invocation's random IDs are removed, including after a partially built fixture.
      await prisma.notification.deleteMany({ where: { bookingId: { in: created.bookings } } });
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
    }
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : 'Transition verification failed'}\n`,
    );
    process.exitCode = 1;
  });
}

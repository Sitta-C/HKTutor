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
import { BookingStatus, RescheduleRequestStatus, Role } from '@generated/prisma/client';
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

/** Never load dotenv/AppModule: the shared project's database must not be a fallback. */
export function disposableDatabaseUrl(): string {
  assert.equal(process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'], '1', 'Explicit opt-in required');
  const value = process.env['DATABASE_URL'];
  assert.ok(value, 'Set an explicit disposable DATABASE_URL');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL is required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only loopback is allowed');
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[_-].+[_-]test$/);
  assert.equal(url.search, '', 'Database URL options/schema overrides are refused');
  assert.equal(url.hash, '', 'Database URL fragments are refused');
  return value;
}

interface Actor {
  id: string;
  token: string;
}

interface Fixture {
  bookingId: string;
  slotId: string;
}

function deferred() {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function main(): Promise<void> {
  const databaseUrl = disposableDatabaseUrl();
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  // A separate control pool holds locks without consuming the application's transaction pool.
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const jwt = new JwtTokenService(
    new AuthConfigService(
      new ConfigService({
        JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
        JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
        JWT_ISSUER: 'hktutor-s2-t25-verifier',
        JWT_AUDIENCE: 'hktutor-s2-t25-verifier',
      }),
    ),
  );
  const created = {
    users: [] as string[],
    bookings: [] as string[],
    slots: [] as string[],
  };
  const listingId = randomUUID();
  const subjectId = randomUUID();
  const gradeLevelId = randomUUID();
  let app: INestApplication<App> | undefined;
  let cancelGate:
    | {
        bookingId: string;
        observed: boolean;
        read: ReturnType<typeof deferred>;
        resume: ReturnType<typeof deferred>;
      }
    | undefined;
  let failAfterSwap: string | undefined;
  let slotSequence = 0;
  let passed = 0;

  function pass(label: string): void {
    passed += 1;
    process.stdout.write(`PASS [real HTTP + PostgreSQL] ${label}\n`);
  }

  try {
    await prisma.$connect();
    const target = await control.query<{ database: string; schema: string }>(
      'SELECT current_database() AS database, current_schema() AS schema',
    );
    assert.deepEqual(target.rows, [
      {
        database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)),
        schema: 'public',
      },
    ]);
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const migrations = await control.query<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations');
    const applied = new Set(
      migrations.rows
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    );
    assert.deepEqual(
      committed.filter((name) => !applied.has(name)),
      [],
      'Apply all committed migrations first',
    );
    assert.equal(
      migrations.rows.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
    );
    for (const index of ['Booking_active_slot_key', 'RescheduleRequest_pending_booking_key']) {
      const found = await control.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
        [index],
      );
      assert.equal(found.rows.length, 1, `Missing ${index}`);
      assert.match(found.rows[0]?.indexdef ?? '', /UNIQUE.*WHERE/);
    }

    // Queries and writes remain real. Only pause the actual cancellation SELECT or inject a
    // failure AFTER the actual swap UPDATE, to prove interleaving and transaction rollback.
    const observedPrisma = prisma.$extends({
      query: {
        booking: {
          async findUnique({ args, query }) {
            const row = await query(args);
            const gate = cancelGate;
            if (gate && args.where.id === gate.bookingId && args.select?.paymentStatus === true) {
              gate.observed = true;
              gate.read.release();
              await gate.resume.ready;
            }
            return row;
          },
          async updateMany({ args, query }) {
            const result = await query(args);
            if (failAfterSwap && args.where?.id === failAfterSwap && args.data.slotId) {
              assert.equal(result.count, 1, 'Inject failure only after the database swap');
              throw new Error('Injected failure after persisted reschedule writes');
            }
            return result;
          },
        },
      },
    });
    const module = await Test.createTestingModule({
      controllers: [
        BookingsController,
        BookingRescheduleRequestsController,
        RescheduleRequestsController,
      ],
      providers: [
        NotificationEventsService,
        BookingsService,
        RescheduleRequestsService,
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

    async function actor(role: Role): Promise<Actor> {
      const id = randomUUID();
      created.users.push(id);
      await prisma.user.create({
        data: {
          id,
          email: `${id}@s2-t25.invalid`,
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
            displayName: 'Reschedule tester',
            bio: 'Synthetic fixture',
            experienceYears: 0,
          },
        });
      }
      const session = await prisma.authSession.create({
        data: {
          userId: id,
          expiresAt: new Date(Date.now() + 300_000),
          refreshTokenHash: randomBytes(32).toString('hex'),
        },
      });
      return { id, token: jwt.signAccessToken(id, session.id, role) };
    }
    const tutor = await actor(Role.TUTOR);
    const student = await actor(Role.STUDENT);
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
        pricePerHour: '500.00',
        description: 'Isolated reschedule concurrency fixture',
      },
    });

    async function slot(
      startAtUtc = new Date(Date.UTC(2099, 0, 1) + slotSequence++ * 7_200_000),
    ): Promise<string> {
      const id = randomUUID();
      created.slots.push(id);
      await prisma.availabilitySlot.create({
        data: {
          id,
          tutorProfileId: tutor.id,
          startAtUtc,
          endAtUtc: new Date(startAtUtc.getTime() + 3_600_000),
        },
      });
      return id;
    }
    async function fixture(): Promise<Fixture> {
      const bookingId = randomUUID();
      const slotId = await slot();
      created.bookings.push(bookingId);
      await prisma.booking.create({
        data: {
          id: bookingId,
          slotId,
          listingId,
          studentUserId: student.id,
          tutorProfileId: tutor.id,
          status: BookingStatus.CONFIRMED,
          subtotalAmount: '500.00',
          netAmount: '500.00',
        },
      });
      return { bookingId, slotId };
    }
    function post(path: string, user: Actor, body: object = {}): request.Test {
      return request(server)
        .post(`/api/v1/${path}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send(body)
        .timeout({ response: 12_000, deadline: 15_000 });
    }
    function create(item: Fixture, targetSlotId: string): request.Test {
      return post(`bookings/${item.bookingId}/reschedule-requests`, student, { targetSlotId });
    }
    async function pending(item: Fixture, target: string): Promise<string> {
      await create(item, target).expect(201);
      const row = await prisma.rescheduleRequest.findFirstOrThrow({
        where: { bookingId: item.bookingId, status: RescheduleRequestStatus.PENDING },
      });
      return row.id;
    }
    function approve(id: string): request.Test {
      return post(`reschedule-requests/${id}/approve`, tutor);
    }
    function cancel(item: Fixture): request.Test {
      return post(`bookings/${item.bookingId}/cancel`, student, { reason: 'Schedule changed' });
    }
    async function snapshot(item: Fixture) {
      return {
        booking: await prisma.booking.findUniqueOrThrow({ where: { id: item.bookingId } }),
        requests: await prisma.rescheduleRequest.findMany({
          where: { bookingId: item.bookingId },
          orderBy: { id: 'asc' },
        }),
        slots: await prisma.availabilitySlot.findMany({
          where: { id: { in: created.slots } },
          orderBy: { id: 'asc' },
        }),
      };
    }

    // Hold a real row lock until both HTTP transactions are observed waiting in PostgreSQL.
    // There is no fabricated conflict or sleep-based assumption that requests overlap.
    async function contend(
      table: 'Booking' | 'AvailabilitySlot',
      id: string,
      calls: () => request.Test[],
    ) {
      const blocker = await control.connect();
      let jobs: Array<Promise<request.Response>> = [];
      let holdingLock = false;
      try {
        await blocker.query('BEGIN');
        holdingLock = true;
        await blocker.query(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, [id]);
        jobs = calls().map((call) => call.then((response) => response));
        // Observe early transport failures while polling; finally still releases the blocker.
        void Promise.allSettled(jobs);
        const deadline = Date.now() + 5000;
        for (;;) {
          const waiting = await control.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'
               AND query LIKE $1`,
            [`%FROM "${table}"%FOR UPDATE%`],
          );
          if ((waiting.rows[0]?.count ?? 0) >= jobs.length) {
            break;
          }
          assert.ok(
            Date.now() < deadline,
            'Both real service transactions must wait for the row lock',
          );
          await delay(20);
        }
        await blocker.query('COMMIT');
        holdingLock = false;
        return await Promise.all(jobs);
      } finally {
        if (holdingLock) {
          await blocker.query('ROLLBACK');
        }
        await Promise.allSettled(jobs);
        blocker.release();
      }
    }

    // Cancellation sees an eligible original class, then approval commits a class in one hour.
    // The stale cancellation must conflict and preserve the newly approved booking.
    const near = await fixture();
    const nearTarget = await slot(new Date(Date.now() + 3_600_000));
    const nearRequest = await pending(near, nearTarget);
    cancelGate = {
      bookingId: near.bookingId,
      observed: false,
      read: deferred(),
      resume: deferred(),
    };
    const cancellation = cancel(near).then((response) => response);
    void cancellation.catch(() => {});
    const readTimeout = setTimeout(() => cancelGate?.read.release(), 5000);
    try {
      await cancelGate.read.ready;
      clearTimeout(readTimeout);
      assert.ok(cancelGate.observed, 'The actual cancellation SELECT must reach the gate');
      await approve(nearRequest).expect(200);
      const afterApproval = await snapshot(near);
      assert.equal(afterApproval.booking.slotId, nearTarget);
      cancelGate.resume.release();
      const response = await cancellation;
      assert.equal(
        response.status,
        409,
        'A changed slot must invalidate the cancellation decision',
      );
      assert.deepEqual(response.body as unknown, {
        statusCode: 409,
        error: 'Conflict',
        code: 'BOOKING_TRANSITION_CONFLICT',
        message: 'The booking was already updated by another request',
      });
      assert.deepEqual(await snapshot(near), afterApproval);
      pass('approval between cancellation read/write preserves the near-term confirmed class');
    } finally {
      clearTimeout(readTimeout);
      cancelGate.resume.release();
      await Promise.allSettled([cancellation]);
      cancelGate = undefined;
    }

    const canceled = await fixture();
    const canceledRequest = await pending(canceled, await slot());
    await cancel(canceled).expect(200);
    const beforeApproval = await snapshot(canceled);
    await approve(canceledRequest).expect(409);
    assert.deepEqual(await snapshot(canceled), beforeApproval);
    pass('cancellation winning first prevents approval and preserves the original slot');

    const duplicate = await fixture();
    const duplicateTarget = await slot();
    const creates = await contend('Booking', duplicate.bookingId, () => [
      create(duplicate, duplicateTarget),
      create(duplicate, duplicateTarget),
    ]);
    assert.deepEqual(creates.map((response) => response.status).sort(), [201, 409]);
    assert.equal(
      await prisma.rescheduleRequest.count({
        where: { bookingId: duplicate.bookingId, status: RescheduleRequestStatus.PENDING },
      }),
      1,
    );
    pass('two contending HTTP creates produce one pending request');

    const first = await fixture();
    const second = await fixture();
    const shared = await slot();
    const firstRequest = await pending(first, shared);
    const secondRequest = await pending(second, shared);
    const beforeFirst = await snapshot(first);
    const beforeSecond = await snapshot(second);
    const approvals = await contend('AvailabilitySlot', shared, () => [
      approve(firstRequest),
      approve(secondRequest),
    ]);
    assert.deepEqual(approvals.map((response) => response.status).sort(), [200, 409]);
    const winner = approvals[0]?.status === 200 ? first : second;
    const loser = winner === first ? second : first;
    const beforeLoser = loser === first ? beforeFirst : beforeSecond;
    assert.deepEqual(
      await snapshot(loser),
      beforeLoser,
      'The losing booking and pending request stay intact',
    );
    assert.equal((await snapshot(winner)).booking.slotId, shared);
    assert.equal(
      await prisma.booking.count({
        where: { slotId: shared, status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
      }),
      1,
    );
    assert.equal(
      await prisma.booking.count({
        where: {
          slotId: winner.slotId,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        },
      }),
      0,
    );
    assert.equal(
      (
        await prisma.rescheduleRequest.findUniqueOrThrow({
          where: { id: winner === first ? firstRequest : secondRequest },
        })
      ).status,
      RescheduleRequestStatus.APPROVED,
    );
    pass(
      'two approvals contending for one target yield one winner, release its old slot, preserve the loser',
    );

    const repeat = await fixture();
    const repeatRequest = await pending(repeat, await slot());
    const decisions = await contend('Booking', repeat.bookingId, () => [
      approve(repeatRequest),
      approve(repeatRequest),
    ]);
    assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 409]);
    pass('two approvals of the same request yield one terminal transition');

    const rollback = await fixture();
    const rollbackRequest = await pending(rollback, await slot());
    const beforeFailure = await snapshot(rollback);
    failAfterSwap = rollback.bookingId;
    try {
      await approve(rollbackRequest).expect(500);
    } finally {
      failAfterSwap = undefined;
    }
    assert.deepEqual(await snapshot(rollback), beforeFailure, 'Both actual writes must roll back');
    pass('injected failure after both real writes rolls back the request and booking');
    process.stdout.write(
      `Reschedule endpoint verification passed: ${passed} real-database checks\n`,
    );
  } finally {
    cancelGate?.resume.release();
    try {
      await prisma.rescheduleRequest.deleteMany({ where: { bookingId: { in: created.bookings } } });
      await prisma.notification.deleteMany({ where: { bookingId: { in: created.bookings } } });
      await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
      await prisma.availabilitySlot.deleteMany({ where: { id: { in: created.slots } } });
      await prisma.teachingListing.deleteMany({ where: { id: listingId } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
      await prisma.subject.deleteMany({ where: { id: subjectId } });
      await prisma.gradeLevel.deleteMany({ where: { id: gradeLevelId } });
    } finally {
      await app?.close();
      await prisma.$disconnect();
      await control.end();
    }
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Reschedule verification failed'}\n`,
    );
    process.exitCode = 1;
  });
}

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { disposableDatabaseUrl } from '@config/disposable-database-url';
import {
  BookingStatus,
  CouponReservationStatus,
  PaymentStatus,
  Prisma,
  Role,
} from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { runSeed } from '@infrastructure/database/seed';
import { SPRINT2_DEMO_IDS } from '@infrastructure/database/seed/sprint2-demo.seed';
import {
  buildSprint3Fixtures,
  SPRINT3_FIXTURE_NOW,
  SPRINT3_IDS,
} from '@infrastructure/database/seed/sprint3-fixtures';
import { seedSprint3Fixtures } from '@infrastructure/database/seed/sprint3-fixtures.seed';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { ReminderJobService } from '@modules/notifications/reminder-job.service';
import { ReviewsService } from '@modules/reviews/reviews.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';

import type { Sprint3ClassFixture } from '@infrastructure/database/seed/sprint3-fixtures';

const HOUR = 3_600_000;

export function disposableSprint3FixtureDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return disposableDatabaseUrl(env);
}

async function verify(): Promise<void> {
  const databaseUrl = disposableSprint3FixtureDatabaseUrl(process.env);
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  try {
    await prisma.$connect();
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const entry of await readdir(resolve(__dirname, '../prisma/migrations'), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        assert.ok(
          applied.some((row) => row.migration_name === entry.name),
          `Missing migration ${entry.name}`,
        );
      }
    }
    assert.equal(
      await prisma.user.count(),
      0,
      'Use a fresh disposable database; fixtures are retained',
    );
    const password = randomBytes(24).toString('hex');
    Object.assign(process.env, {
      SEED_ADMIN_EMAIL: 'admin@s3db04-runner.invalid',
      SEED_ADMIN_PASSWORD: password,
      SEED_TUTOR_EMAIL: 'tutor@s3db04-runner.invalid',
      SEED_TUTOR_PASSWORD: password,
      SEED_STUDENT_EMAIL: 'student@s3db04-runner.invalid',
      SEED_STUDENT_PASSWORD: password,
    });
    const fixtures = buildSprint3Fixtures();
    process.stdout.write(
      `DB04 fixture input sha256=${createHash('sha256').update(JSON.stringify(fixtures)).digest('hex')}\n`,
    );
    const fixture = (key: string): Sprint3ClassFixture => {
      const row = fixtures.classes.find((item) => item.key === key);
      assert.ok(row, `Missing fixture ${key}`);
      return row;
    };
    const coupon = (key: string) => {
      const row = fixtures.coupons.find((item) => item.key === key);
      assert.ok(row, `Missing coupon ${key}`);
      return row;
    };
    await prisma.user.create({
      data: {
        id: SPRINT3_IDS.student,
        email: 'collision@s3db04-runner.invalid',
        role: Role.STUDENT,
      },
    });
    await assert.rejects(runSeed(prisma, SPRINT3_FIXTURE_NOW), /fixture identity collision/);
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.booking.count(), 0);
    assert.equal(await prisma.coupon.count(), 0);
    await prisma.user.delete({ where: { id: SPRINT3_IDS.student } });
    const sentinel = await prisma.user.create({
      data: {
        email: 'non-fixture@s3db04-runner.invalid',
        role: Role.STUDENT,
      },
    });
    let passed = 0;
    const pass = (label: string): void => {
      passed += 1;
      process.stdout.write(`PASS [PostgreSQL] ${label}\n`);
    };
    pass('identity collision rolls back the entire combined seed before any fixture survives');
    const snapshot = () => prisma.$queryRaw`
      SELECT jsonb_build_object(
        'users', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "User" t WHERE id::text LIKE 'db040000-%'),
        'tutors', (SELECT jsonb_agg(to_jsonb(t) ORDER BY "userId") FROM "TutorProfile" t WHERE "userId"::text LIKE 'db040000-%'),
        'slots', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "AvailabilitySlot" t WHERE id::text LIKE 'db040000-%'),
        'bookings', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Booking" t WHERE id::text LIKE 'db040000-%'),
        'reviews', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Review" t WHERE id::text LIKE 'db040000-%'),
        'coupons', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Coupon" t WHERE id::text LIKE 'db040000-%'),
        'attempts', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "PaymentAttempt" t WHERE id::text LIKE 'db040000-%'),
        'reservations', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "CouponReservation" t WHERE id::text LIKE 'db040000-%'),
        'uses', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "CouponUse" t WHERE id::text LIKE 'db040000-%'),
        'audit', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "AuditLog" t WHERE "entityId"::text LIKE 'db040000-%'),
        'reschedules', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "RescheduleRequest" t WHERE id::text LIKE 'db040000-%')
        ,'notifications', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Notification" t WHERE "bookingId"::text LIKE 'db040000-%')
      ) AS snapshot`;

    await runSeed(prisma, SPRINT3_FIXTURE_NOW);
    assert.equal(
      await prisma.booking.count({ where: { tutorProfileId: SPRINT3_IDS.tutors.report905 } }),
      12,
    );
    assert.equal(
      await prisma.booking.count({ where: { id: { in: fixtures.classes.map((row) => row.id) } } }),
      fixtures.classes.length,
    );
    pass('combined runSeed creates every DB04 class');
    const initial = await snapshot();
    await runSeed(prisma, SPRINT3_FIXTURE_NOW);
    assert.deepEqual(await snapshot(), initial);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: sentinel.id } }), sentinel);
    pass(
      'second combined seed preserves every DB04 row, audit, timestamp and non-fixture sentinel',
    );
    // S3-T23: the DB02 trigger writes exactly one safe creation audit per coupon, and a repeated
    // seed (an idempotent create retry) must not add another one.
    const creationAudits = await prisma.auditLog.findMany({
      where: { action: 'coupon.create', entityId: { in: fixtures.coupons.map((row) => row.id) } },
      select: { entityId: true, entityType: true, operationKey: true, afterData: true },
      orderBy: { entityId: 'asc' },
    });
    assert.deepEqual(
      creationAudits,
      [...fixtures.coupons]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((row) => ({
          entityId: row.id,
          entityType: 'Coupon',
          operationKey: `coupon.create:${row.id}`,
          afterData: { percent: row.percent, maxUses: row.maxUses, active: row.active },
        })),
    );
    pass('each fixture coupon has exactly one safe coupon.create audit after a repeated seed');

    const directory = new TutorDirectoryService(prisma);
    for (const [group, average, count] of [
      ['review433', 4.33, 2],
      ['review400', 4, 1],
      ['review100', 1, 1],
      ['review500', 5, 1],
      ['newTutor', null, 0],
    ] as const) {
      const tutorId = SPRINT3_IDS.tutors[group];
      const result = await directory.getPublicTutor(tutorId);
      assert.equal(result.tutor.ratingAverage, average);
      assert.equal(result.tutor.reviewCount, count);
      const raw = await prisma.$queryRaw<{ average: string | null; count: number }[]>`
        SELECT round(avg((clarity + punctuality + preparation)::numeric / 3), 2)::text AS average,
          count(*)::int AS count FROM "Review" WHERE "tutorProfileId" = ${tutorId}::uuid`;
      assert.deepEqual(raw, [{ average: average === null ? null : average.toFixed(2), count }]);
    }
    pass('five independent raw review totals and public detail ratings/counts');
    const reviews = new ReviewsService(prisma);
    const saved = await reviews.findMine(fixture('review-545').id, SPRINT3_IDS.student);
    assert.equal(saved.review?.overallRating, 4.67);
    await assert.rejects(reviews.findMine(fixture('review-545').id, SPRINT3_IDS.otherStudent));
    pass('review fixture reads through owner service and rejects another student');

    const ledger = await prisma.booking.findMany({
      where: { tutorProfileId: SPRINT3_IDS.tutors.report905 },
    });
    const counts = Object.fromEntries(
      Object.values(BookingStatus).map((status) => [
        status,
        ledger.filter((row) => row.status === status).length,
      ]),
    );
    assert.deepEqual(counts, { PENDING: 3, CONFIRMED: 1, COMPLETED: 6, CANCELED: 2, EXPIRED: 0 });
    const revenue = await prisma.booking.aggregate({
      where: {
        tutorProfileId: SPRINT3_IDS.tutors.report905,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
      },
      _sum: { netAmount: true },
    });
    assert.equal(revenue._sum.netAmount?.toFixed(2), '905.00');
    assert.equal(
      new Prisma.Decimal(counts['COMPLETED'] ?? 0)
        .dividedBy((counts['COMPLETED'] ?? 0) + (counts['CANCELED'] ?? 0))
        .times(100)
        .toFixed(2),
      '75.00',
    );
    for (const group of ['reportEmpty', 'reportExpired', 'reportUnfinalized'] as const) {
      const finalized = await prisma.booking.count({
        where: {
          tutorProfileId: SPRINT3_IDS.tutors[group],
          status: { in: [BookingStatus.COMPLETED, BookingStatus.CANCELED] },
        },
      });
      assert.equal(finalized, 0);
    }
    assert.equal(
      await prisma.booking.count({ where: { tutorProfileId: SPRINT3_IDS.tutors.reportEmpty } }),
      0,
    );
    assert.equal(
      await prisma.booking.count({
        where: { tutorProfileId: SPRINT3_IDS.tutors.reportExpired, status: BookingStatus.EXPIRED },
      }),
      1,
    );
    pass('isolated report ledger: 12 / 6 / 2 / 3 / 1 / 0, 905.00 THB, 75%, empty and unfinalized');

    const events = new NotificationEventsService();
    const bookings = new BookingsService(prisma, events);
    const detail = await bookings.getMyBookingById({
      bookingId: fixture('report-1').id,
      studentUserId: SPRINT3_IDS.student,
    });
    assert.equal(detail.subtotalAmount, '450.00');
    assert.equal(detail.discountAmount, '45.00');
    assert.equal(detail.netAmount, '405.00');
    assert.equal(detail.coupon?.code, 'WELCOME10');
    for (const key of ['exhausted', 'lastUse']) {
      const used = await prisma.couponUse.count({ where: { couponId: coupon(key).id } });
      const reserved = await prisma.couponReservation.count({
        where: { couponId: coupon(key).id, status: CouponReservationStatus.RESERVED },
      });
      assert.equal(coupon(key).maxUses - used - reserved, key === 'exhausted' ? 0 : 1);
    }
    for (const key of ['active', 'uncertain']) {
      assert.equal(
        await prisma.couponReservation.count({
          where: { couponId: coupon(key).id, status: CouponReservationStatus.RESERVED },
        }),
        1,
      );
      assert.equal(await prisma.couponUse.count({ where: { couponId: coupon(key).id } }), 0);
    }
    for (const key of ['released-failed', 'released-expired']) {
      assert.equal(
        await prisma.couponReservation.count({
          where: { couponId: coupon(key).id, status: CouponReservationStatus.RELEASED },
        }),
        1,
      );
      assert.equal(await prisma.couponUse.count({ where: { couponId: coupon(key).id } }), 0);
    }
    const free = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture('free-settled').id },
    });
    assert.equal(free.paymentReference, `coupon:${fixture('free-settled').reservationId}`);
    assert.equal(await prisma.paymentAttempt.count({ where: { bookingId: free.id } }), 0);
    assert.equal(await prisma.couponUse.count({ where: { bookingId: free.id } }), 1);
    assert.equal(
      await prisma.paymentAttempt.count({
        where: { bookingId: fixture('below-provider-minimum').id },
      }),
      0,
    );
    pass(
      'coupon capacities, releases, consumption, zero receipt, provider-minimum input and booking wire snapshot',
    );

    const job = new ReminderJobService(prisma, events);
    for (const scenario of fixtures.reminders) {
      const row = fixtures.classes.find((item) => item.id === scenario.bookingId);
      assert.ok(row);
      const outcome = await job.runOnce(scenario.now);
      assert.equal(outcome.failed, 0, scenario.key);
      const stored = await prisma.notification.findMany({
        where: { bookingId: row.id, eventKey: { contains: `:${row.slotId}:` } },
        orderBy: [{ userId: 'asc' }, { eventType: 'asc' }],
      });
      const expected: { userId: string; eventType: string }[] = [];
      if (scenario.expectedRecipients > 0) {
        if (row.paid) {
          expected.push(
            { userId: row.tutorId, eventType: `CLASS_REMINDER_${scenario.expectedBand}` },
            { userId: row.studentId, eventType: `CLASS_REMINDER_${scenario.expectedBand}` },
          );
        } else {
          expected.push({
            userId: row.studentId,
            eventType: `PAYMENT_REMINDER_${scenario.expectedBand}`,
          });
        }
      }
      expected.sort(
        (a, b) => a.userId.localeCompare(b.userId) || a.eventType.localeCompare(b.eventType),
      );
      assert.deepEqual(
        stored.map(({ userId, eventType }) => ({ userId, eventType })),
        expected,
        scenario.key,
      );
      for (const notification of stored) {
        assert.ok(
          notification.eventKey.includes(`:${row.slotId}:${row.startAtUtc.toISOString()}:`),
        );
      }
      const repeated = await job.runOnce(scenario.now);
      assert.equal(repeated.created, 0, `duplicate ${scenario.key}`);
      pass(`reminder ${scenario.key}: exact recipients/types/event occurrence and repeat`);
    }
    const twoBands = fixture('24h-unpaid');
    await job.runOnce(new Date(twoBands.startAtUtc.getTime() - HOUR));
    assert.equal(await prisma.notification.count({ where: { bookingId: twoBands.id } }), 2);
    const rescheduled = fixture('rescheduled');
    const change = await prisma.rescheduleRequest.findFirstOrThrow({
      where: { bookingId: rescheduled.id },
    });
    assert.equal(change.status, 'APPROVED');
    assert.equal(change.requestedSlotId, rescheduled.slotId);
    assert.notEqual(change.fromSlotId, rescheduled.slotId);
    assert.equal(await prisma.notification.count({ where: { bookingId: rescheduled.id } }), 2);
    assert.equal(
      await prisma.notification.count({
        where: { bookingId: rescheduled.id, eventKey: { contains: `:${change.fromSlotId}:` } },
      }),
      1,
    );
    const midnight = fixture('bangkok-year-midnight');
    assert.equal(
      new Date(midnight.startAtUtc.getTime() + 7 * HOUR).toISOString(),
      '2032-01-01T00:00:00.000Z',
    );
    pass('separate 24H/1H events, approved reschedule and Bangkok year boundary');

    const beforeFailure = await snapshot();
    await assert.rejects(
      prisma.$transaction(
        async (tx) => {
          await tx.booking.update({
            where: { id: fixture('coupon-unapplied').id },
            data: { meetingUrl: 'https://example.invalid/rollback' },
          });
          await seedSprint3Fixtures(tx, SPRINT3_FIXTURE_NOW);
          throw new Error('Injected fixture failure');
        },
        { timeout: 30_000 },
      ),
      /Injected fixture failure/,
    );
    assert.deepEqual(await snapshot(), beforeFailure);
    pass('enclosing seed transaction rolls back without partial writes');

    const liveReviewBooking = fixture('report-3');
    await reviews.create(liveReviewBooking.id, SPRINT3_IDS.student, {
      clarity: 3,
      punctuality: 3,
      preparation: 3,
      feedback: 'Synthetic post-seed review',
    });
    await prisma.booking.update({
      where: { id: fixture('coupon-unapplied').id },
      data: { meetingUrl: 'https://example.invalid/preserve' },
    });
    await prisma.paymentAttempt.update({
      where: { id: fixture('uncertain').attemptId },
      data: { failureCode: 'STILL_UNCERTAIN' },
    });
    const evolved = await snapshot();
    await runSeed(prisma, new Date(SPRINT3_FIXTURE_NOW.getTime() + 86400000));
    assert.deepEqual(await snapshot(), evolved);
    assert.deepEqual(await prisma.user.findUnique({ where: { id: sentinel.id } }), sentinel);
    pass(
      'next-day combined seed preserves a new review, changed booking, uncertain attempt, consumed coupons and non-fixture rows',
    );
    const oldDemo = await prisma.booking.findUniqueOrThrow({
      where: { id: SPRINT2_DEMO_IDS.endedClassBooking },
    });
    await prisma.paymentAttempt.create({
      data: {
        bookingId: oldDemo.id,
        amount: oldDemo.netAmount,
        currency: oldDemo.currency,
        status: 'SUCCESSFUL',
        chargeId: 'chrg_test_DB04OldDemo',
        paidAt: SPRINT3_FIXTURE_NOW,
      },
    });
    await runSeed(prisma, new Date(SPRINT3_FIXTURE_NOW.getTime() + 2 * 86400000));
    assert.deepEqual(await prisma.booking.findUnique({ where: { id: oldDemo.id } }), oldDemo);
    pass('operational Sprint 2 demo with provider evidence is not reset or moved');
    const originalDetail = await bookings.getMyBookingById({
      bookingId: fixture('report-1').id,
      studentUserId: SPRINT3_IDS.student,
    });
    await prisma.teachingListing.update({
      where: { id: originalDetail.listing.id },
      data: { pricePerHour: '999.00' },
    });
    await prisma.coupon.update({ where: { id: coupon('welcome10').id }, data: { percent: 20 } });
    await runSeed(prisma, new Date(SPRINT3_FIXTURE_NOW.getTime() + 3 * 86400000));
    const historicalDetail = await bookings.getMyBookingById({
      bookingId: fixture('report-1').id,
      studentUserId: SPRINT3_IDS.student,
    });
    assert.equal(historicalDetail.subtotalAmount, '450.00');
    assert.equal(historicalDetail.discountAmount, '45.00');
    assert.equal(historicalDetail.netAmount, '405.00');
    assert.equal(historicalDetail.coupon?.percent, 10);
    assert.equal(
      (await prisma.coupon.findUniqueOrThrow({ where: { id: coupon('welcome10').id } })).percent,
      20,
    );
    pass('seed preserves edited live prices/coupons and historical booking snapshots do not drift');
    process.stdout.write(
      `Sprint 3 fixture verification: ${passed} checks passed; synthetic rows retained.\n`,
    );
  } finally {
    await prisma.$disconnect();
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
    process.stderr.write(
      `Sprint 3 fixture verification failed (${reason}); inspect the disposable database.\n`,
    );
    process.exitCode = 1;
  });
}

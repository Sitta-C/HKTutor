import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import { PaymentsConfigService } from '@config/payments.config';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { OmiseService } from '@infrastructure/payments/omise.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingCouponsService } from '@modules/bookings/booking-coupons.service';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { OmiseWebhookController, PaymentsController } from '@modules/payments/payments.controller';
import { PaymentsService } from '@modules/payments/payments.service';

import type { Coupon } from '@generated/prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

export function disposableCouponPaymentDatabaseUrl(env: NodeJS.ProcessEnv): string {
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
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  return value;
}

interface StubCharge {
  object: 'charge';
  id: string;
  livemode: false;
  amount: number;
  currency: string;
  status: 'pending' | 'successful' | 'failed' | 'expired';
  paid: boolean;
  paid_at: string | null;
  expires_at: string;
  metadata: { bookingId: string; attemptId: string };
  source: { type: 'promptpay'; scannable_code: { image: { download_uri: string } } };
}

// Retains synthetic append-only evidence: discard only this runner's isolated database afterward.
async function verify(): Promise<void> {
  const databaseUrl = disposableCouponPaymentDatabaseUrl(process.env);
  const webhookSecret = randomBytes(32).toString('base64');
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
    OMISE_SECRET_KEY: 'skey_test_fixture',
    OMISE_WEBHOOK_SECRET: webhookSecret,
  });
  const prisma = new PrismaService(config);
  const control = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10_000,
  });
  const tokens = new JwtTokenService(new AuthConfigService(config));
  const omise = new OmiseService(new PaymentsConfigService(config));
  const payments = new PaymentsService(prisma, omise, new NotificationEventsService());
  const bookings = new BookingsService(prisma, new NotificationEventsService());
  const bookingCoupons = new BookingCouponsService(prisma);
  const charges = new Map<string, StubCharge>();
  const originalFetch = globalThis.fetch;
  let creates = 0;
  let reads = 0;
  let mode: 'normal' | 'timeout' | 'reject' | 'unavailable' = 'normal';
  let gate: Promise<void> | undefined;
  let onCreate: (() => void) | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(typeof input, 'string');
    if (typeof input !== 'string') {
      throw new Error('Expected provider URL');
    }
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.omise.co', 'Unexpected outbound request');
    if (init?.method === 'POST') {
      creates += 1;
      assert.ok(init.body instanceof URLSearchParams);
      if (mode === 'reject') {
        mode = 'normal';
        return new Response('{}', { status: 422 });
      }
      const form = init.body;
      const charge: StubCharge = {
        object: 'charge',
        id: `chrg_test_${randomUUID().replaceAll('-', '')}`,
        livemode: false,
        amount: Number(form.get('amount')),
        currency: 'thb',
        status: 'pending',
        paid: false,
        paid_at: null,
        expires_at: String(form.get('expires_at')),
        metadata: {
          bookingId: String(form.get('metadata[bookingId]')),
          attemptId: String(form.get('metadata[attemptId]')),
        },
        source: {
          type: 'promptpay',
          scannable_code: { image: { download_uri: 'https://api.omise.co/test.svg' } },
        },
      };
      charges.set(charge.id, charge);
      onCreate?.();
      if (gate) {
        await gate;
      }
      if (mode === 'timeout') {
        mode = 'normal';
        throw new Error('Simulated response loss');
      }
      return Response.json(charge);
    }
    reads += 1;
    if (mode === 'unavailable') {
      return new Response('{}', { status: 503 });
    }
    if (url.pathname === '/charges') {
      return Response.json({ data: [...charges.values()] });
    }
    const charge = charges.get(url.pathname.slice('/charges/'.length));
    assert.ok(charge, 'Unknown stub charge');
    return Response.json(charge);
  };
  let app: INestApplication<App> | undefined;
  let checks = 0;
  const pass = (label: string): void => {
    checks += 1;
    process.stdout.write(`PASS [PostgreSQL + signed HTTP + stub provider] ${label}\n`);
  };
  const tutorId = randomUUID();
  const subjectId = randomUUID();
  const gradeId = randomUUID();
  const listingId = randomUUID();
  const studentIds: string[] = [];
  let sequence = 0;
  // A Promise.all alone does not establish overlap: observe every contender waiting in PostgreSQL.
  async function contend<T>(
    table: 'Booking' | 'Coupon',
    id: string,
    operations: (() => Promise<T>)[],
    expectedWaiters = operations.length,
  ): Promise<PromiseSettledResult<T>[]> {
    const lock = await control.connect();
    let pending: Promise<PromiseSettledResult<T>[]> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query(`SELECT id FROM "${table}" WHERE id=$1::uuid FOR UPDATE`, [id]);
      const pid = (await lock.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
        ?.pid;
      assert.ok(pid);
      pending = Promise.allSettled(
        operations.map((operation) => Promise.resolve().then(operation)),
      );
      const deadline = Date.now() + 3000;
      for (;;) {
        const waiting = await control.query<{ count: number }>(
          `
          WITH RECURSIVE blocked(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))
            UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
          ) SELECT count(DISTINCT pid)::int AS count FROM blocked`,
          [pid],
        );
        if ((waiting.rows[0]?.count ?? 0) >= expectedWaiters) {
          break;
        }
        assert.ok(
          Date.now() < deadline,
          `Expected ${expectedWaiters} real PostgreSQL lock waiters on ${table}`,
        );
        await setTimeout(10);
      }
      process.stdout.write(
        `PASS [observed PostgreSQL locks] ${expectedWaiters}/${operations.length} operations waiting on ${table}\n`,
      );
    } finally {
      try {
        await lock.query('ROLLBACK');
      } finally {
        lock.release();
        await pending;
      }
    }
    assert.ok(pending);
    return pending;
  }
  async function state(id: string) {
    return {
      booking: await prisma.booking.findUniqueOrThrow({ where: { id } }),
      attempts: await prisma.paymentAttempt.findMany({
        where: { bookingId: id },
        orderBy: { id: 'asc' },
      }),
      reservations: await prisma.couponReservation.findMany({
        where: { bookingId: id },
        orderBy: { id: 'asc' },
      }),
      uses: await prisma.couponUse.findMany({ where: { bookingId: id }, orderBy: { id: 'asc' } }),
      audit: await prisma.auditLog.findMany({ orderBy: { id: 'asc' } }),
    };
  }
  async function coupon(percent = 10, maxUses = 1): Promise<Coupon> {
    return prisma.coupon.create({
      data: {
        code: randomUUID().replaceAll('-', '').toUpperCase(),
        percent,
        maxUses,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  }
  async function fixture(applied?: Coupon, subtotal = '450.00', studentUserId?: string) {
    const studentId = studentUserId ?? randomUUID();
    if (!studentUserId) {
      studentIds.push(studentId);
      await prisma.user.create({
        data: {
          id: studentId,
          email: `${studentId}@example.test`,
          role: 'STUDENT',
          emailVerifiedAt: new Date(),
          consentAcceptedAt: new Date(),
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        },
      });
    }
    const session = await prisma.authSession.create({
      data: {
        userId: studentId,
        refreshTokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    sequence += 1;
    const startAtUtc = new Date(Date.now() + (48 + sequence * 2) * 3600000);
    const slot = await prisma.availabilitySlot.create({
      data: {
        tutorProfileId: tutorId,
        startAtUtc,
        endAtUtc: new Date(startAtUtc.getTime() + 3600000),
      },
    });
    const base = new Prisma.Decimal(subtotal);
    const discount = applied
      ? base.mul(applied.percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0);
    const booking = await prisma.booking.create({
      data: {
        studentUserId: studentId,
        tutorProfileId: tutorId,
        listingId,
        slotId: slot.id,
        status: 'CONFIRMED',
        subtotalAmount: base,
        discountAmount: discount,
        netAmount: base.minus(discount),
        appliedCouponId: applied?.id ?? null,
        appliedCouponCode: applied?.code ?? null,
        appliedCouponPercent: applied?.percent ?? null,
      },
    });
    return {
      id: booking.id,
      studentId,
      token: tokens.signAccessToken(studentId, session.id, 'STUDENT'),
    };
  }
  const latest = (id: string): StubCharge => {
    const charge = [...charges.values()].filter((item) => item.metadata.bookingId === id).at(-1);
    assert.ok(charge);
    return charge;
  };
  const paid = (charge: StubCharge): void => {
    charge.status = 'successful';
    charge.paid = true;
    charge.paid_at = new Date().toISOString();
  };
  async function event(charge: StubCharge, status = 200): Promise<void> {
    assert.ok(app);
    // Deliberately contradict retrieved truth: the signed body is only a routing signal.
    const body = JSON.stringify({
      object: 'event',
      livemode: false,
      key: 'charge.complete',
      data: { id: charge.id, status: 'failed', metadata: charge.metadata },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', Buffer.from(webhookSecret, 'base64'))
      .update(`${timestamp}.${body}`)
      .digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/payments/omise/webhook')
      .set('Content-Type', 'application/json')
      .set('Omise-Signature-Timestamp', timestamp)
      .set('Omise-Signature', signature)
      .send(body)
      .expect(status);
  }
  async function evidence(id: string, status: 'RESERVED' | 'CONSUMED' | 'RELEASED'): Promise<void> {
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id } });
    assert.ok(booking.subtotalAmount.minus(booking.discountAmount).equals(booking.netAmount));
    assert.equal(booking.paymentStatus, status === 'CONSUMED' ? 'PAID' : 'UNPAID');
    assert.equal(booking.paymentPending, status === 'RESERVED');
    const reservation = await prisma.couponReservation.findFirstOrThrow({
      where: { bookingId: id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(reservation.status, status);
    assert.ok(reservation.discountAmount.equals(booking.discountAmount));
    const attempt = reservation.paymentAttemptId
      ? await prisma.paymentAttempt.findUniqueOrThrow({
          where: { id: reservation.paymentAttemptId },
        })
      : null;
    if (attempt) {
      assert.ok(attempt.amount.equals(booking.netAmount));
      assert.equal(attempt.currency, booking.currency);
      assert.equal(attempt.appliedCouponId, booking.appliedCouponId);
      assert.ok(
        status === 'CONSUMED'
          ? attempt.status === 'SUCCESSFUL'
          : status === 'RESERVED'
            ? ['CREATING', 'PENDING'].includes(attempt.status)
            : ['FAILED', 'EXPIRED'].includes(attempt.status),
      );
    } else {
      assert.equal(booking.netAmount.toFixed(2), '0.00');
    }
    assert.equal(
      await prisma.couponUse.count({ where: { bookingId: id } }),
      status === 'CONSUMED' ? 1 : 0,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          entityId: reservation.id,
          action: `coupon.${status === 'RESERVED' ? 'reserve' : status === 'CONSUMED' ? 'consume' : 'release'}`,
        },
      }),
      1,
    );
  }
  try {
    await prisma.$connect();
    const applied = await prisma.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const entry of await readdir(resolve('prisma/migrations'), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        assert.ok(
          applied.some((row) => row.migration_name === entry.name),
          `Missing migration ${entry.name}`,
        );
      }
    }
    const module = await Test.createTestingModule({
      controllers: [BookingsController, PaymentsController, OmiseWebhookController],
      providers: [
        { provide: BookingsService, useValue: bookings },
        { provide: BookingCouponsService, useValue: bookingCoupons },
        { provide: PaymentsService, useValue: payments },
        { provide: OmiseService, useValue: omise },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtTokenService, useValue: tokens },
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    configureApplication(app);
    await app.init();
    await prisma.user.create({
      data: { id: tutorId, email: `${tutorId}@example.test`, role: 'TUTOR' },
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutorId,
        displayName: 'Coupon payment fixture',
        bio: 'Disposable',
        experienceYears: 1,
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
        description: 'Disposable coupon payment verification fixture',
      },
    });

    const deadlineCoupon = await coupon(10, 100);
    for (const operation of ['apply', 'remove'] as const) {
      const target = await fixture(operation === 'remove' ? deadlineCoupon : undefined);
      const original = await prisma.booking.findUniqueOrThrow({
        where: { id: target.id },
        include: { slot: true },
      });
      const startsAt = new Date(Date.now() + 2500);
      await prisma.availabilitySlot.update({
        where: { id: original.slotId },
        data: { startAtUtc: startsAt, endAtUtc: new Date(startsAt.getTime() + 3_600_000) },
      });
      const beforeDeadlineWrite = await state(target.id);
      try {
        // Sequence increments survive rollback, proving the real UPDATE reached this trigger.
        await prisma.$executeRawUnsafe('CREATE SEQUENCE coupon_deadline_write_counter');
        await prisma.$executeRawUnsafe(`CREATE FUNCTION coupon_deadline_write_probe()
          RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW."id" = '${target.id}'::uuid THEN
            PERFORM nextval('coupon_deadline_write_counter');
            PERFORM pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM
              ('${startsAt.toISOString()}'::timestamptz - clock_timestamp()))) + 0.15);
          END IF;
          RETURN NEW; END $$`);
        await prisma.$executeRawUnsafe(
          'CREATE TRIGGER coupon_deadline_write_probe AFTER UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION coupon_deadline_write_probe()',
        );
        await assert.rejects(
          operation === 'apply'
            ? bookingCoupons.applyCoupon(target.id, target.studentId, { code: deadlineCoupon.code })
            : bookingCoupons.removeCoupon(target.id, target.studentId),
          (error: unknown) => {
            assert.ok(error instanceof HttpException);
            assert.equal(error.getStatus(), 409);
            const body = error.getResponse();
            assert.ok(typeof body === 'object' && 'code' in body);
            assert.equal(body.code, 'BOOKING_PAYMENT_DEADLINE_PASSED');
            return true;
          },
        );
        const [probe] = await prisma.$queryRaw<{ value: number; called: boolean }[]>`
          SELECT last_value::int AS value, is_called AS called FROM coupon_deadline_write_counter`;
        assert.ok(probe);
        assert.equal(probe.called, true, 'The UPDATE must actually execute before the deadline');
        assert.equal(probe.value, 1);
        assert.deepEqual(await state(target.id), beforeDeadlineWrite);
        pass(
          `${operation} crossing lesson start during a real UPDATE rolls back coupon, amounts and evidence`,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS coupon_deadline_write_probe ON "Booking"',
        );
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS coupon_deadline_write_probe()');
        await prisma.$executeRawUnsafe('DROP SEQUENCE IF EXISTS coupon_deadline_write_counter');
        await prisma.availabilitySlot.update({
          where: { id: original.slotId },
          data: { startAtUtc: original.slot.startAtUtc, endAtUtc: original.slot.endAtUtc },
        });
      }
    }

    const final = await coupon();
    const a = await fixture(final);
    const b = await fixture(final);
    const beforeRace = creates;
    const race = await contend('Coupon', final.id, [
      () => payments.create(a.id, a.studentId),
      () => payments.create(b.id, b.studentId),
    ]);
    assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(creates, beforeRace + 1);
    const winner = race[0]?.status === 'fulfilled' ? a : b;
    const loser = winner.id === a.id ? b : a;
    const losingResult = race.find((item) => item.status === 'rejected');
    assert.ok(losingResult?.status === 'rejected');
    assert.ok(
      losingResult.reason instanceof HttpException && losingResult.reason.getStatus() === 409,
    );
    const loserState = await state(loser.id);
    assert.equal(loserState.booking.paymentPending, false);
    assert.equal(loserState.booking.paymentStatus, 'UNPAID');
    assert.equal(loserState.booking.netAmount.toFixed(2), '405.00');
    assert.equal(
      loserState.attempts.length + loserState.reservations.length + loserState.uses.length,
      0,
    );
    await evidence(winner.id, 'RESERVED');
    assert.equal(
      await prisma.couponReservation.count({ where: { couponId: final.id, status: 'RESERVED' } }),
      1,
    );
    assert.equal(
      await prisma.paymentAttempt.count({ where: { bookingId: { in: [a.id, b.id] } } }),
      1,
    );
    await payments.create(winner.id, winner.studentId);
    assert.equal(creates, beforeRace + 1);
    await assert.rejects(
      bookings.cancelBooking({
        bookingId: winner.id,
        userId: winner.studentId,
        reason: 'active payment',
      }),
    );
    await prisma.coupon.update({
      where: { id: final.id },
      data: { expiresAt: new Date(0), active: false },
    });
    paid(latest(winner.id));
    const settlement = await contend('Booking', winner.id, [
      () => event(latest(winner.id)),
      () => event(latest(winner.id)),
      () => payments.getStatus(winner.id, winner.studentId).then(() => undefined),
    ]);
    assert.ok(settlement.every((item) => item.status === 'fulfilled'));
    await evidence(winner.id, 'CONSUMED');
    assert.equal((await payments.create(winner.id, winner.studentId)).paymentStatus, 'PAID');
    latest(winner.id).status = 'failed';
    await event(latest(winner.id));
    await evidence(winner.id, 'CONSUMED');
    pass(
      'final-use race, one QR, duplicate/current replay, reserved expiry/deactivation honored, late failure no-op',
    );

    const reusable = await coupon(10, 5);
    const first = await fixture(reusable);
    await payments.create(first.id, first.studentId);
    paid(latest(first.id));
    await event(latest(first.id));
    const reused = await fixture(reusable, '450.00', first.studentId);
    const beforeReuse = creates;
    await assert.rejects(payments.create(reused.id, reused.studentId));
    assert.equal(creates, beforeReuse);
    pass('same-student reuse blocked before provider');

    // Capacity is deliberately > 1: it is the student claim, not exhaustion, that must win.
    const studentCoupon = await coupon(10, 5);
    const studentFirst = await fixture(studentCoupon);
    const studentSecond = await fixture(studentCoupon, '450.00', studentFirst.studentId);
    const beforeStudentRace = creates;
    const studentRace = await contend('Coupon', studentCoupon.id, [
      () => payments.create(studentFirst.id, studentFirst.studentId),
      () => payments.create(studentSecond.id, studentSecond.studentId),
    ]);
    assert.equal(studentRace.filter((item) => item.status === 'fulfilled').length, 1);
    const studentLoser = studentRace.find((item) => item.status === 'rejected');
    assert.ok(studentLoser?.status === 'rejected');
    assert.ok(studentLoser.reason instanceof HttpException);
    assert.equal(studentLoser.reason.getStatus(), 409);
    assert.deepEqual(studentLoser.reason.getResponse(), {
      code: 'COUPON_ALREADY_USED',
      message: 'Coupon is already claimed by this student',
    });
    assert.equal(creates, beforeStudentRace + 1);
    assert.equal(
      await prisma.couponReservation.count({ where: { couponId: studentCoupon.id } }),
      1,
    );
    assert.equal(await prisma.couponUse.count({ where: { couponId: studentCoupon.id } }), 0);
    const studentWinner = studentRace[0]?.status === 'fulfilled' ? studentFirst : studentSecond;
    const studentRejected = studentWinner.id === studentFirst.id ? studentSecond : studentFirst;
    const rejectedState = await state(studentRejected.id);
    assert.equal(rejectedState.booking.paymentPending, false);
    assert.equal(
      rejectedState.attempts.length + rejectedState.reservations.length + rejectedState.uses.length,
      0,
    );
    paid(latest(studentWinner.id));
    await event(latest(studentWinner.id));
    const afterStudentPaid = await state(studentRejected.id);
    await assert.rejects(
      payments.create(studentRejected.id, studentRejected.studentId),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 409,
    );
    assert.deepEqual(await state(studentRejected.id), afterStudentPaid);
    await evidence(studentWinner.id, 'CONSUMED');
    assert.equal(creates, beforeStudentRace + 1);
    pass(
      'same student/two bookings race: one claim, loser COUPON_ALREADY_USED, one use after success',
    );

    for (const terminal of ['failed', 'expired'] as const) {
      const expiringCoupon = await coupon();
      const f = await fixture(expiringCoupon);
      await payments.create(f.id, f.studentId);
      await prisma.coupon.update({
        where: { id: expiringCoupon.id },
        data: { expiresAt: new Date(0) },
      });
      latest(f.id).status = terminal;
      const releases = await contend('Booking', f.id, [
        () => event(latest(f.id)),
        () => event(latest(f.id)),
        () => payments.getStatus(f.id, f.studentId).then(() => undefined),
      ]);
      assert.ok(releases.every((item) => item.status === 'fulfilled'));
      await evidence(f.id, 'RELEASED');
      const released = await state(f.id);
      const beforeRetry = creates;
      await assert.rejects(
        payments.create(f.id, f.studentId),
        (error: unknown) =>
          error instanceof HttpException &&
          error.getStatus() === 409 &&
          JSON.stringify(error.getResponse()).includes('COUPON_EXPIRED'),
      );
      await event(latest(f.id));
      assert.deepEqual(await state(f.id), released);
      assert.equal(creates, beforeRetry);
    }
    pass(
      'failed/expired callback+current replay releases once; fresh retry revalidates coupon expiry without writes',
    );

    const uncertain = await fixture(await coupon());
    mode = 'timeout';
    await assert.rejects(payments.create(uncertain.id, uncertain.studentId));
    await evidence(uncertain.id, 'RESERVED');
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({
      where: { bookingId: uncertain.id },
    });
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { createdAt: new Date(Date.now() - 20000) },
    });
    const beforeRecovery = creates;
    mode = 'unavailable';
    await assert.rejects(payments.getStatus(uncertain.id, uncertain.studentId));
    await assert.rejects(payments.create(uncertain.id, uncertain.studentId));
    assert.equal(creates, beforeRecovery);
    await evidence(uncertain.id, 'RESERVED');
    mode = 'normal';
    const lost = latest(uncertain.id);
    charges.delete(lost.id);
    assert.equal(
      (await payments.getStatus(uncertain.id, uncertain.studentId)).attempt?.status,
      'CREATING',
    );
    await evidence(uncertain.id, 'RESERVED');
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: uncertain.id } })).paymentPending,
      true,
    );
    charges.set(lost.id, lost);
    lost.expires_at = new Date(0).toISOString();
    assert.equal(
      (await payments.getStatus(uncertain.id, uncertain.studentId)).attempt?.status,
      'PENDING',
    );
    assert.equal(creates, beforeRecovery);
    // An elapsed QR deadline is not provider confirmation of expiry.
    await payments.create(uncertain.id, uncertain.studentId);
    await evidence(uncertain.id, 'RESERVED');
    assert.equal(creates, beforeRecovery);
    latest(uncertain.id).status = 'expired';
    await payments.getStatus(uncertain.id, uncertain.studentId);
    await evidence(uncertain.id, 'RELEASED');
    await payments.create(uncertain.id, uncertain.studentId);
    assert.equal(creates, beforeRecovery + 1);
    pass(
      'timeout/503 retain reservation, metadata recovery never POSTs, confirmed expiry releases and retries',
    );

    const rejected = await fixture(await coupon());
    mode = 'reject';
    await assert.rejects(payments.create(rejected.id, rejected.studentId));
    await evidence(rejected.id, 'RELEASED');
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: rejected.id } })).paymentPending,
      false,
    );
    await payments.create(rejected.id, rejected.studentId);
    latest(rejected.id).status = 'failed';
    await event(latest(rejected.id));
    await evidence(rejected.id, 'RELEASED');
    pass('definitive no-charge rejection and verified failure release atomically');

    const zero = await fixture(await coupon(100));
    const disabled = new PaymentsService(
      prisma,
      new OmiseService(new PaymentsConfigService(new ConfigService({}))),
      new NotificationEventsService(),
    );
    const beforeZero = creates;
    const zeroResults = await contend('Booking', zero.id, [
      () => disabled.create(zero.id, zero.studentId),
      () => disabled.create(zero.id, zero.studentId),
    ]);
    const receipts = zeroResults.map((item) => {
      assert.equal(item.status, 'fulfilled');
      assert.ok(item.status === 'fulfilled');
      return item.value;
    });
    assert.ok(receipts.every((item) => item.paymentStatus === 'PAID' && item.attempt === null));
    assert.equal(receipts[0]?.reference, receipts[1]?.reference);
    assert.match(receipts[0]?.reference ?? '', /^coupon:/);
    assert.equal(creates, beforeZero);
    assert.equal(await prisma.paymentAttempt.count({ where: { bookingId: zero.id } }), 0);
    await evidence(zero.id, 'CONSUMED');
    await assert.rejects(
      bookings.cancelBooking({ bookingId: zero.id, userId: zero.studentId, reason: 'paid' }),
    );
    pass(
      'concurrent zero settlement, one receipt/use/audit, no configuration or charge, paid cancellation denied',
    );

    for (const amount of ['19.99', '150000.01']) {
      const invalid = await fixture(undefined, amount);
      const before = creates;
      await assert.rejects(payments.create(invalid.id, invalid.studentId));
      assert.equal(creates, before);
      assert.equal(await prisma.paymentAttempt.count({ where: { bookingId: invalid.id } }), 0);
    }
    for (const amount of ['20.00', '150000.00']) {
      const boundary = await fixture(undefined, amount);
      await payments.create(boundary.id, boundary.studentId);
      assert.equal(latest(boundary.id).amount, new Prisma.Decimal(amount).mul(100).toNumber());
    }
    const tooSmall = await fixture(await coupon(99), '450.00');
    const beforeSmall = creates;
    await assert.rejects(payments.create(tooSmall.id, tooSmall.studentId));
    assert.equal(creates, beforeSmall);
    assert.equal(await prisma.couponReservation.count({ where: { bookingId: tooSmall.id } }), 0);
    pass(
      '19.99/20.00/150000.00/150000.01 and discounted subminimum amount before reservation/provider',
    );

    for (const change of [
      { active: false },
      { expiresAt: new Date(0) },
      { percent: 20 },
      { code: randomUUID().replaceAll('-', '').toUpperCase() },
    ]) {
      const c = await coupon();
      const stale = await fixture(c);
      await prisma.coupon.update({ where: { id: c.id }, data: change });
      const before = creates;
      await assert.rejects(payments.create(stale.id, stale.studentId));
      assert.equal(creates, before);
      assert.equal(await prisma.couponReservation.count({ where: { bookingId: stale.id } }), 0);
    }
    pass('inactive/expired and stale applied percentage/code rejected with no claim');

    const rollback = await fixture(await coupon());
    await payments.create(rollback.id, rollback.studentId);
    paid(latest(rollback.id));
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION coupon_payment_rollback_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${rollback.id}'::uuid AND NEW."paymentStatus" = 'paid' THEN RAISE EXCEPTION 'intentional rollback'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER coupon_payment_rollback_probe AFTER UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION coupon_payment_rollback_probe()',
    );
    const beforeRollback = await state(rollback.id);
    await event(latest(rollback.id), 500);
    assert.deepEqual(await state(rollback.id), beforeRollback);
    await evidence(rollback.id, 'RESERVED');
    assert.equal(
      (await prisma.paymentAttempt.findFirstOrThrow({ where: { bookingId: rollback.id } })).status,
      'PENDING',
    );
    await prisma.$executeRawUnsafe('DROP TRIGGER coupon_payment_rollback_probe ON "Booking"');
    await prisma.$executeRawUnsafe('DROP FUNCTION coupon_payment_rollback_probe()');
    await event(latest(rollback.id));
    await evidence(rollback.id, 'CONSUMED');
    pass('database failure rolls back booking/attempt/use/audit, signed retry settles once');

    const frozen = await fixture(await coupon());
    let release = (): void => {};
    gate = new Promise<void>((done) => {
      release = done;
    });
    const started = new Promise<void>((done) => {
      onCreate = done;
    });
    const creating = payments.create(frozen.id, frozen.studentId);
    await started;
    try {
      await assert.rejects(
        prisma.booking.update({
          where: { id: frozen.id },
          data: {
            appliedCouponId: null,
            appliedCouponCode: null,
            appliedCouponPercent: null,
            discountAmount: '0.00',
            netAmount: '450.00',
          },
        }),
      );
      await assert.rejects(
        bookings.cancelBooking({ bookingId: frozen.id, userId: frozen.studentId, reason: 'race' }),
      );
    } finally {
      release();
      gate = undefined;
      onCreate = undefined;
    }
    await creating;
    pass('claim committed before HTTP: pending provider freezes coupon removal and cancellation');

    for (let index = 0; index < 4; index += 1) {
      const f = await fixture(await coupon());
      const racing = await contend('Booking', f.id, [
        () => payments.create(f.id, f.studentId).then(() => undefined),
        () =>
          bookings
            .cancelBooking({
              bookingId: f.id,
              userId: f.studentId,
              reason: 'concurrent cancellation',
            })
            .then(() => undefined),
      ]);
      assert.equal(racing.filter((item) => item.status === 'fulfilled').length, 1);
      for (const result of racing) {
        if (result.status === 'rejected') {
          assert.ok(result.reason instanceof HttpException && result.reason.getStatus() === 409);
        }
      }
      const b = await prisma.booking.findUniqueOrThrow({ where: { id: f.id } });
      const reservations = await prisma.couponReservation.count({ where: { bookingId: f.id } });
      assert.ok(
        (b.status === 'CANCELED' && !b.paymentPending && reservations === 0) ||
          (b.status === 'CONFIRMED' && b.paymentPending && reservations === 1),
      );
    }
    pass('four concurrent payment/cancellation races preserve claim and state');

    for (const action of ['apply', 'remove', 'replace'] as const) {
      for (let index = 0; index < 3; index += 1) {
        const initialCoupon = action === 'apply' ? undefined : await coupon();
        const nextCoupon = action === 'remove' ? undefined : await coupon(20);
        const f = await fixture(initialCoupon);
        const results = await contend('Booking', f.id, [
          () => payments.create(f.id, f.studentId).then(() => undefined),
          () =>
            (nextCoupon
              ? bookingCoupons.applyCoupon(f.id, f.studentId, { code: nextCoupon.code })
              : bookingCoupons.removeCoupon(f.id, f.studentId)
            ).then(() => undefined),
        ]);
        assert.equal(results[0]?.status, 'fulfilled');
        for (const result of results) {
          if (result.status === 'rejected') {
            assert.ok(result.reason instanceof HttpException && result.reason.getStatus() === 409);
          }
        }
        const stored = await prisma.booking.findUniqueOrThrow({ where: { id: f.id } });
        const a = await prisma.paymentAttempt.findFirstOrThrow({ where: { bookingId: f.id } });
        assert.equal(a.amount.toFixed(2), stored.netAmount.toFixed(2));
        assert.equal(a.appliedCouponId, stored.appliedCouponId);
        assert.equal(latest(f.id).amount, stored.netAmount.mul(100).toNumber());
        assert.equal(
          await prisma.couponReservation.count({ where: { bookingId: f.id } }),
          stored.appliedCouponId ? 1 : 0,
        );
      }
    }
    pass(
      'nine T25 apply/remove/replace service races with T26 QR create keep attempt, amount and reservation aligned',
    );

    for (const action of ['cancel', 'apply', 'remove'] as const) {
      const f = await fixture(await coupon());
      const replacement = await coupon(20);
      await payments.create(f.id, f.studentId);
      const original = await prisma.booking.findUniqueOrThrow({ where: { id: f.id } });
      assert.ok(original.appliedCouponId);
      paid(latest(f.id));
      const results = await contend(
        'Booking',
        f.id,
        [
          () => event(latest(f.id)),
          () => payments.getStatus(f.id, f.studentId).then(() => undefined),
          () =>
            (action === 'cancel'
              ? bookings.cancelBooking({
                  bookingId: f.id,
                  userId: f.studentId,
                  reason: 'success race',
                })
              : action === 'apply'
                ? bookingCoupons.applyCoupon(f.id, f.studentId, { code: replacement.code })
                : bookingCoupons.removeCoupon(f.id, f.studentId)
            ).then(() => undefined),
        ],
        action === 'cancel' ? 2 : 3,
      ); // Cancellation rejects the active payment before acquiring a lock.
      assert.equal(results[0]?.status, 'fulfilled');
      assert.equal(results[1]?.status, 'fulfilled');
      const mutation = results[2];
      assert.ok(mutation?.status === 'rejected');
      assert.ok(mutation.reason instanceof HttpException && mutation.reason.getStatus() === 409);
      await evidence(f.id, 'CONSUMED');
      const stored = await prisma.booking.findUniqueOrThrow({ where: { id: f.id } });
      assert.equal(stored.status, 'CONFIRMED');
      assert.equal(stored.netAmount.toFixed(2), original.netAmount.toFixed(2));
      assert.equal(stored.appliedCouponId, original.appliedCouponId);
      assert.equal(latest(f.id).amount, 40500);
      assert.equal(
        await prisma.couponReservation.count({ where: { couponId: replacement.id } }),
        0,
      );
      assert.equal(
        await prisma.couponUse.count({ where: { couponId: original.appliedCouponId } }),
        1,
      );
    }
    pass(
      'verified success races cancellation/apply/remove: paid/use/attempt atomic, fixed QR amount, no refunded use',
    );

    // Integrate actual T25/T26 HTTP controllers rather than manufacturing an applied snapshot.
    const journey = await fixture();
    const journeyCoupon = await coupon();
    const journeyBase = `/api/v1/bookings/me/${journey.id}`;
    await request(app.getHttpServer())
      .put(`${journeyBase}/coupon`)
      .auth(journey.token, { type: 'bearer' })
      .send({ code: journeyCoupon.code.toLowerCase() })
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        assert.ok(typeof body === 'object' && body !== null && 'netAmount' in body);
        assert.equal(body.netAmount, '405.00');
      });
    const beforeJourney = creates;
    await request(app.getHttpServer())
      .post(`${journeyBase}/payments/promptpay`)
      .auth(journey.token, { type: 'bearer' })
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${journeyBase}/coupon`)
      .auth(journey.token, { type: 'bearer' })
      .expect(409);
    paid(latest(journey.id));
    await event(latest(journey.id));
    for (const method of ['get', 'post'] as const) {
      await request(app.getHttpServer())
        [method](`${journeyBase}/payments/${method === 'get' ? 'current' : 'promptpay'}`)
        .auth(journey.token, { type: 'bearer' })
        .expect(200)
        .expect(({ body }: { body: unknown }) => {
          assert.ok(
            typeof body === 'object' &&
              body !== null &&
              'paymentStatus' in body &&
              'netAmount' in body &&
              'reference' in body,
          );
          assert.equal(body.paymentStatus, 'PAID');
          assert.equal(body.netAmount, '405.00');
          assert.equal(body.reference, latest(journey.id).id);
        });
    }
    assert.equal(creates, beforeJourney + 1);
    await evidence(journey.id, 'CONSUMED');
    await request(app.getHttpServer())
      .post(`${journeyBase}/mock-payment`)
      .auth(journey.token, { type: 'bearer' })
      .send({})
      .expect(410);
    const legacy = await fixture();
    const legacyAt = new Date('2026-10-01T00:00:00Z');
    await prisma.booking.update({
      where: { id: legacy.id },
      data: {
        paymentStatus: 'PAID',
        paidAt: legacyAt,
        mockReference: `LEGACY-${legacy.id}`,
      },
    });
    const legacyBefore = await state(legacy.id);
    const legacyReceipt = await payments.create(legacy.id, legacy.studentId);
    assert.equal(legacyReceipt.reference, `LEGACY-${legacy.id}`);
    assert.equal(legacyReceipt.paidAt, legacyAt.toISOString());
    assert.equal(legacyReceipt.attempt, null);
    assert.equal(creates, beforeJourney + 1);
    assert.deepEqual(await state(legacy.id), legacyBefore);
    pass(
      'T25 apply -> T26 QR -> signed success -> repeat receipt via HTTP; legacy receipt preserved and mock write 410',
    );

    const zeroRollback = await fixture(await coupon(100));
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION coupon_payment_rollback_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${zeroRollback.id}'::uuid AND NEW."paymentStatus" = 'paid' THEN RAISE EXCEPTION 'intentional zero rollback'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER coupon_payment_rollback_probe AFTER UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION coupon_payment_rollback_probe()',
    );
    const beforeZeroRollback = await state(zeroRollback.id);
    await assert.rejects(disabled.create(zeroRollback.id, zeroRollback.studentId));
    assert.deepEqual(await state(zeroRollback.id), beforeZeroRollback);
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: zeroRollback.id } })).paymentStatus,
      'UNPAID',
    );
    assert.equal(
      await prisma.couponReservation.count({ where: { bookingId: zeroRollback.id } }),
      0,
    );
    assert.equal(await prisma.couponUse.count({ where: { bookingId: zeroRollback.id } }), 0);
    await prisma.$executeRawUnsafe('DROP TRIGGER coupon_payment_rollback_probe ON "Booking"');
    await prisma.$executeRawUnsafe('DROP FUNCTION coupon_payment_rollback_probe()');
    await disabled.create(zeroRollback.id, zeroRollback.studentId);
    await evidence(zeroRollback.id, 'CONSUMED');
    pass('zero settlement rollback removes all consumption evidence, retry settles once');

    for (const sqlState of ['40001', '40P01']) {
      for (const failures of [2, 3]) {
        const retryFixture = await fixture(await coupon());
        await prisma.$executeRawUnsafe('CREATE SEQUENCE db05_retry_counter');
        await prisma.$executeRawUnsafe(`CREATE FUNCTION db05_retry_probe() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.id='${retryFixture.id}'::uuid AND NEW."paymentPending" AND NOT OLD."paymentPending"
            AND nextval('db05_retry_counter')<=${failures} THEN
            RAISE EXCEPTION USING ERRCODE='${sqlState}', MESSAGE='DB05 injected transaction retry';
          END IF; RETURN NEW; END $$`);
        await prisma.$executeRawUnsafe(
          'CREATE TRIGGER db05_retry_probe BEFORE UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION db05_retry_probe()',
        );
        try {
          const before = await state(retryFixture.id);
          const providerBefore = creates;
          if (failures === 2) {
            await payments.create(retryFixture.id, retryFixture.studentId);
            assert.equal(creates, providerBefore + 1);
            await evidence(retryFixture.id, 'RESERVED');
          } else {
            await assert.rejects(
              payments.create(retryFixture.id, retryFixture.studentId),
              (error: unknown) =>
                error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034',
            );
            assert.deepEqual(await state(retryFixture.id), before);
            assert.equal(creates, providerBefore);
          }
          const counter = await prisma.$queryRaw<
            { value: number }[]
          >`SELECT last_value::int AS value FROM db05_retry_counter`;
          assert.equal(
            counter[0]?.value,
            3,
            'Initial attempt plus at most two full transaction retries',
          );
        } finally {
          await prisma.$executeRawUnsafe('DROP TRIGGER db05_retry_probe ON "Booking"');
          await prisma.$executeRawUnsafe('DROP FUNCTION db05_retry_probe()');
          await prisma.$executeRawUnsafe('DROP SEQUENCE db05_retry_counter');
        }
      }
      pass(
        `SQLSTATE ${sqlState} maps to P2034: two whole-transaction retries, one provider call after success, no state after exhaustion`,
      );
    }

    const base = `/api/v1/bookings/me/${zero.id}/payments`;
    await request(app.getHttpServer()).post(`${base}/promptpay`).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/promptpay`)
      .auth(zero.token, { type: 'bearer' })
      .send({ amount: '0', couponCode: 'CLIENT' })
      .expect(400);
    await request(app.getHttpServer())
      .get(`${base}/current`)
      .auth(zero.token, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await prisma.user.update({ where: { id: zero.studentId }, data: { policyVersion: 'old' } });
    await request(app.getHttpServer())
      .post(`${base}/promptpay`)
      .auth(zero.token, { type: 'bearer' })
      .expect(403);
    const readsBefore = reads;
    await request(app.getHttpServer())
      .post('/api/v1/payments/omise/webhook')
      .send({ object: 'event' })
      .expect(401);
    assert.equal(reads, readsBefore);
    pass(
      'real JWT/session/consent, empty-body validation, no-store and invalid HMAC before provider access',
    );
    for (const [label, id] of [
      ['final-use winner', winner.id],
      ['final-use loser', loser.id],
      ['zero settlement', zero.id],
      ['HTTP discounted journey', journey.id],
    ] as const) {
      const snapshot = await state(id);
      const receipt = await payments.getStatus(id, snapshot.booking.studentUserId);
      const reservationIds = snapshot.reservations.map((row) => row.id);
      process.stdout.write(
        `EVIDENCE ${JSON.stringify({
          label,
          paymentStatus: receipt.paymentStatus,
          paymentPending: receipt.paymentPending,
          subtotal: receipt.subtotalAmount,
          discount: receipt.discountAmount,
          net: receipt.netAmount,
          attemptStatus: receipt.attempt?.status ?? null,
          attempts: snapshot.attempts.length,
          reserved: snapshot.reservations.filter((row) => row.status === 'RESERVED').length,
          consumed: snapshot.reservations.filter((row) => row.status === 'CONSUMED').length,
          uses: snapshot.uses.length,
          consumeAudits: snapshot.audit.filter(
            (row) => row.action === 'coupon.consume' && reservationIds.includes(row.entityId),
          ).length,
          providerCreates: [...charges.values()].filter((row) => row.metadata.bookingId === id)
            .length,
          receiptKind: receipt.reference?.startsWith('coupon:')
            ? 'coupon'
            : receipt.reference
              ? 'test charge'
              : null,
        })}\n`,
      );
    }
    process.stdout.write(`${checks} coupon payment checks passed. No live provider contacted.\n`);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS coupon_payment_rollback_probe ON "Booking"',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS coupon_payment_rollback_probe()');
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS db05_retry_probe ON "Booking"');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS db05_retry_probe()');
      await prisma.$executeRawUnsafe('DROP SEQUENCE IF EXISTS db05_retry_counter');
    } finally {
      try {
        await app?.close();
      } finally {
        await Promise.all([prisma.$disconnect(), control.end()]);
      }
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      error instanceof assert.AssertionError
        ? `Assertion failed: ${error.message}\n`
        : 'Coupon payment verification failed; no credentials/provider payload logged.\n',
    );
    process.exitCode = 1;
  });
}

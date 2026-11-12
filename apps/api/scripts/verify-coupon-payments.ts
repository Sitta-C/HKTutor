import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
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
  const tokens = new JwtTokenService(new AuthConfigService(config));
  const omise = new OmiseService(new PaymentsConfigService(config));
  const payments = new PaymentsService(prisma, omise);
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
    const reservation = await prisma.couponReservation.findFirstOrThrow({
      where: { bookingId: id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(reservation.status, status);
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
      controllers: [PaymentsController, OmiseWebhookController],
      providers: [
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
    const bookings = new BookingsService(prisma, new NotificationEventsService());
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

    const final = await coupon();
    const a = await fixture(final);
    const b = await fixture(final);
    const beforeRace = creates;
    const race = await Promise.allSettled([
      payments.create(a.id, a.studentId),
      payments.create(b.id, b.studentId),
    ]);
    assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(creates, beforeRace + 1);
    const winner = race[0]?.status === 'fulfilled' ? a : b;
    await evidence(winner.id, 'RESERVED');
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
    await Promise.all([
      event(latest(winner.id)),
      event(latest(winner.id)),
      payments.getStatus(winner.id, winner.studentId),
    ]);
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
    assert.equal(
      (await payments.getStatus(uncertain.id, uncertain.studentId)).attempt?.status,
      'PENDING',
    );
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
    );
    const beforeZero = creates;
    const receipts = await Promise.all([
      disabled.create(zero.id, zero.studentId),
      disabled.create(zero.id, zero.studentId),
    ]);
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
    await event(latest(rollback.id), 500);
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
      await Promise.allSettled([
        payments.create(f.id, f.studentId),
        bookings.cancelBooking({
          bookingId: f.id,
          userId: f.studentId,
          reason: 'concurrent cancellation',
        }),
      ]);
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
        const discount = new Prisma.Decimal('450.00').mul(nextCoupon?.percent ?? 0).div(100);
        const results = await Promise.allSettled([
          payments.create(f.id, f.studentId),
          prisma.booking.update({
            where: { id: f.id },
            data: {
              appliedCouponId: nextCoupon?.id ?? null,
              appliedCouponCode: nextCoupon?.code ?? null,
              appliedCouponPercent: nextCoupon?.percent ?? null,
              discountAmount: discount,
              netAmount: new Prisma.Decimal('450.00').minus(discount),
            },
          }),
        ]);
        assert.equal(results[0]?.status, 'fulfilled');
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
      'nine apply/remove/replace database-write races keep attempt, amount and reservation aligned',
    );

    const zeroRollback = await fixture(await coupon(100));
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION coupon_payment_rollback_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${zeroRollback.id}'::uuid AND NEW."paymentStatus" = 'paid' THEN RAISE EXCEPTION 'intentional zero rollback'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER coupon_payment_rollback_probe AFTER UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION coupon_payment_rollback_probe()',
    );
    await assert.rejects(disabled.create(zeroRollback.id, zeroRollback.studentId));
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
    process.stdout.write(`${checks} coupon payment checks passed. No live provider contacted.\n`);
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS coupon_payment_rollback_probe ON "Booking"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS coupon_payment_rollback_probe()');
    await app?.close();
    await prisma.$disconnect();
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

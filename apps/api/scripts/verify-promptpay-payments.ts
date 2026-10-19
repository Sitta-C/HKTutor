import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { OmiseRequestRejected, OmiseService } from '@infrastructure/payments/omise.service';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { PaymentsService } from '@modules/payments/payments.service';

import type { OmiseCharge } from '@infrastructure/payments/omise.service';

async function main(): Promise<void> {
  assert.equal(process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'], '1');
  const connectionString = process.env['DATABASE_URL'];
  assert.ok(
    connectionString,
    'Set a disposable DATABASE_URL explicitly; this script does not load .env',
  );
  const url = new URL(connectionString);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[-_]/);
  assert.equal(url.search, '');
  assert.equal(url.hash, '');

  const charges = new Map<string, OmiseCharge>();
  let creates = 0;
  let mode: 'normal' | 'timeout' | 'rejected' = 'normal';
  let createGate: Promise<void> | null = null;
  let notifyStarted: (() => void) | null = null;
  const omise = {
    assertEnabled: () => undefined,
    createCharge: async (input: {
      amount: number;
      attemptId: string;
      bookingId: string;
      expiresAt: Date;
    }): Promise<OmiseCharge> => {
      creates += 1;
      if (mode === 'rejected') {
        mode = 'normal';
        throw new OmiseRequestRejected();
      }
      const charge: OmiseCharge = {
        id: `chrg_test_${randomUUID().replaceAll('-', '')}`,
        amount: input.amount,
        currency: 'THB',
        bookingId: input.bookingId,
        attemptId: input.attemptId,
        status: 'pending',
        paid: false,
        paidAt: null,
        expiresAt: input.expiresAt,
        qrCodeUrl: 'https://api.omise.co/test.svg',
        failureCode: null,
      };
      charges.set(charge.id, charge);
      notifyStarted?.();
      if (createGate) {
        await createGate;
      }
      if (mode === 'timeout') {
        mode = 'normal';
        throw new Error('Simulated response loss');
      }
      return charge;
    },
    retrieveCharge: (id: string): Promise<OmiseCharge> => {
      const charge = charges.get(id);
      assert.ok(charge);
      return Promise.resolve(charge);
    },
    findCharge: (attemptId: string): Promise<OmiseCharge | null> =>
      Promise.resolve(
        [...charges.values()].find((charge) => charge.attemptId === attemptId) ?? null,
      ),
  };
  const module = await Test.createTestingModule({
    providers: [
      { provide: ConfigService, useValue: new ConfigService({ DATABASE_URL: connectionString }) },
      PrismaService,
      PaymentsService,
      BookingsService,
      { provide: NotificationEventsService, useValue: { write: () => Promise.resolve() } },
      { provide: OmiseService, useValue: omise },
    ],
  }).compile();
  const prisma = module.get(PrismaService);
  const payments = module.get(PaymentsService);
  const bookings = module.get(BookingsService);
  const studentId = randomUUID();
  const tutorId = randomUUID();
  const subjectId = randomUUID();
  const gradeId = randomUUID();
  const listingId = randomUUID();
  const bookingIds: string[] = [];
  const slotIds: string[] = [];
  let sequence = 0;
  async function fixture(): Promise<string> {
    sequence += 1;
    const startAtUtc = new Date(Date.now() + (48 + sequence * 2) * 3_600_000);
    const slot = await prisma.availabilitySlot.create({
      data: {
        tutorProfileId: tutorId,
        startAtUtc,
        endAtUtc: new Date(startAtUtc.getTime() + 3_600_000),
      },
    });
    slotIds.push(slot.id);
    const booking = await prisma.booking.create({
      data: {
        studentUserId: studentId,
        tutorProfileId: tutorId,
        listingId,
        slotId: slot.id,
        status: 'CONFIRMED',
        subtotalAmount: '450.00',
        netAmount: '450.00',
      },
    });
    bookingIds.push(booking.id);
    return booking.id;
  }
  function currentCharge(bookingId: string): OmiseCharge {
    const charge = [...charges.values()].filter((item) => item.bookingId === bookingId).at(-1);
    assert.ok(charge);
    return charge;
  }
  async function webhook(charge: OmiseCharge): Promise<void> {
    await payments.webhook({
      object: 'event',
      livemode: false,
      key: 'charge.complete',
      data: { id: charge.id },
    });
  }

  try {
    await prisma.user.createMany({
      data: [
        { id: studentId, email: `${studentId}@payment.test`, role: 'STUDENT' },
        { id: tutorId, email: `${tutorId}@payment.test`, role: 'TUTOR' },
      ],
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutorId,
        displayName: 'Payment test',
        bio: 'Disposable fixture',
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
        description: 'Disposable payment test',
      },
    });

    const bookingId = await fixture();
    let release = () => {};
    createGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const first = payments.create(bookingId, studentId);
    await started;
    const second = await payments.create(bookingId, studentId);
    assert.equal(second.paymentPending, true);
    await assert.rejects(
      bookings.cancelBooking({ bookingId, userId: studentId, reason: 'Cannot cancel active QR' }),
    );
    release();
    await first;
    createGate = null;
    notifyStarted = null;
    assert.equal(creates, 1);
    await assert.rejects(
      prisma.paymentAttempt.create({ data: { bookingId, amount: '450.00', currency: 'THB' } }),
    );
    const charge = currentCharge(bookingId);
    charge.status = 'successful';
    charge.paid = true;
    charge.paidAt = new Date();
    await Promise.all([webhook(charge), webhook(charge)]);
    const paid = await payments.getStatus(bookingId, studentId);
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(paid.reference, charge.id);
    await payments.create(bookingId, studentId);
    assert.equal(creates, 1);
    assert.equal(
      await prisma.paymentAttempt.count({ where: { bookingId, status: 'SUCCESSFUL' } }),
      1,
    );
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).mockReference,
      null,
    );

    const unknownId = await fixture();
    mode = 'timeout';
    await assert.rejects(payments.create(unknownId, studentId));
    const unknown = await prisma.paymentAttempt.findFirstOrThrow({
      where: { bookingId: unknownId },
    });
    assert.equal(unknown.status, 'CREATING');
    await prisma.paymentAttempt.update({
      where: { id: unknown.id },
      data: { createdAt: new Date(Date.now() - 20_000) },
    });
    const beforeRecovery = creates;
    const recovered = await payments.create(unknownId, studentId);
    assert.equal(recovered.attempt?.status, 'PENDING');
    assert.equal(creates, beforeRecovery);
    const failed = currentCharge(unknownId);
    failed.status = 'failed';
    await payments.getStatus(unknownId, studentId);
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: unknownId } })).paymentPending,
      false,
    );
    await payments.create(unknownId, studentId);
    assert.equal(creates, beforeRecovery + 1);

    const rejectedId = await fixture();
    mode = 'rejected';
    await assert.rejects(payments.create(rejectedId, studentId));
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: rejectedId } })).paymentPending,
      false,
    );
    await payments.create(rejectedId, studentId);

    for (let index = 0; index < 8; index += 1) {
      const raceId = await fixture();
      const race = await Promise.allSettled([
        payments.create(raceId, studentId),
        bookings.cancelBooking({
          bookingId: raceId,
          userId: studentId,
          reason: 'Race verification',
        }),
      ]);
      assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
      const saved = await prisma.booking.findUniqueOrThrow({ where: { id: raceId } });
      const count = await prisma.paymentAttempt.count({ where: { bookingId: raceId } });
      assert.ok(
        (saved.status === 'CANCELED' && !saved.paymentPending && count === 0) ||
          (saved.status === 'CONFIRMED' && saved.paymentPending && count === 1),
      );
    }

    const rollbackId = await fixture();
    await payments.create(rollbackId, studentId);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION promptpay_probe_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${rollbackId}'::uuid AND NEW."paymentStatus" = 'paid' THEN RAISE EXCEPTION 'intentional payment rollback probe'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER promptpay_probe_failure AFTER UPDATE ON "Booking" FOR EACH ROW EXECUTE FUNCTION promptpay_probe_failure()',
    );
    const rollbackCharge = currentCharge(rollbackId);
    rollbackCharge.status = 'successful';
    rollbackCharge.paid = true;
    rollbackCharge.paidAt = new Date();
    await assert.rejects(webhook(rollbackCharge));
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: rollbackId } })).paymentStatus,
      'UNPAID',
    );
    assert.equal(
      (await prisma.paymentAttempt.findFirstOrThrow({ where: { bookingId: rollbackId } })).status,
      'PENDING',
    );
    await prisma.$executeRawUnsafe('DROP TRIGGER promptpay_probe_failure ON "Booking"');
    await prisma.$executeRawUnsafe('DROP FUNCTION promptpay_probe_failure()');
    await webhook(rollbackCharge);
    console.info(
      'PromptPay database verification passed: duplicate claims, callback replay, timeout recovery, rejection/retry, 8 payment/cancellation races and transaction rollback.',
    );
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS promptpay_probe_failure ON "Booking"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS promptpay_probe_failure()');
    await prisma.paymentAttempt.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availabilitySlot.deleteMany({ where: { id: { in: slotIds } } });
    await prisma.teachingListing.deleteMany({ where: { id: listingId } });
    await prisma.tutorProfile.deleteMany({ where: { userId: tutorId } });
    await prisma.subject.deleteMany({ where: { id: subjectId } });
    await prisma.gradeLevel.deleteMany({ where: { id: gradeId } });
    await prisma.user.deleteMany({ where: { id: { in: [studentId, tutorId] } } });
    await module.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Payment verification failed');
  process.exitCode = 1;
});

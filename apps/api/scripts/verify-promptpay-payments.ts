import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';

import { Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { OmiseRequestRejected, OmiseService } from '@infrastructure/payments/omise.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { BookingExpiryService } from '@modules/bookings/booking-expiry.service';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { PaymentsService } from '@modules/payments/payments.service';
import { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

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

  const control = new Pool({ connectionString, max: 2 });
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
      BookingExpiryService,
      RescheduleRequestsService,
      BookingsService,
      NotificationEventsService,
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
        {
          id: studentId,
          email: `${studentId}@payment.test`,
          role: 'STUDENT',
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
          consentAcceptedAt: new Date(),
        },
        {
          id: tutorId,
          email: `${tutorId}@payment.test`,
          role: 'TUTOR',
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
          consentAcceptedAt: new Date(),
        },
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

    const expiry = module.get(BookingExpiryService);
    const deadlineBookingId = await fixture();
    const deadlineBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: deadlineBookingId },
    });
    const closeSlot = async (remainingMs: number) => {
      const startAtUtc = new Date(Date.now() + remainingMs);
      await prisma.availabilitySlot.update({
        where: { id: deadlineBooking.slotId },
        data: { startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 3_600_000) },
      });
      return startAtUtc;
    };
    // A last-minute QR is capped by the booking deadline, not the usual 15-minute TTL.
    const nearStart = await closeSlot(5 * 60_000);
    await payments.create(deadlineBookingId, studentId);
    const nearCharge = currentCharge(deadlineBookingId);
    assert.equal(nearCharge.expiresAt?.getTime(), nearStart.getTime());
    await closeSlot(-60_000);
    await expiry.runOnce(new Date());
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: deadlineBookingId } })).status,
      'CONFIRMED',
    );
    // Status reads never invent another charge, even after the deadline.
    const createsBeforeRecovery = creates;
    await payments.create(deadlineBookingId, studentId);
    assert.equal(creates, createsBeforeRecovery);
    nearCharge.status = 'successful';
    nearCharge.paid = true;
    nearCharge.paidAt = new Date();
    await webhook(nearCharge);
    await expiry.runOnce(new Date());
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: deadlineBookingId } })).paymentStatus,
      'PAID',
    );
    // Return the slot to its own isolated range before testing another overdue booking.
    await closeSlot(24 * 3_600_000);

    const overdueId = await fixture();
    const overdue = await prisma.booking.findUniqueOrThrow({ where: { id: overdueId } });
    const overdueStart = new Date(Date.now() - 1000);
    await prisma.availabilitySlot.update({
      where: { id: overdue.slotId },
      data: { startAtUtc: overdueStart, endAtUtc: new Date(overdueStart.getTime() + 3_600_000) },
    });
    const beforeClosed = creates;
    await assert.rejects(
      payments.create(overdueId, studentId),
      (error: unknown) => error instanceof Error && error.message.includes('lesson starts'),
    );
    assert.equal(creates, beforeClosed);
    await prisma.booking.update({ where: { id: overdueId }, data: { status: 'PENDING' } });
    const outcomes = await Promise.allSettled([
      bookings.confirmTutorBooking({ bookingId: overdueId, tutorUserId: tutorId }),
      expiry.runOnce(new Date()),
    ]);
    assert.equal(outcomes[0]?.status, 'rejected');
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: overdueId } })).status,
      'EXPIRED',
    );
    await prisma.availabilitySlot.update({
      where: { id: overdue.slotId },
      data: {
        startAtUtc: new Date(Date.now() + 26 * 3_600_000),
        endAtUtc: new Date(Date.now() + 27 * 3_600_000),
      },
    });

    // Cross the deadline while a real PostgreSQL row lock blocks confirmation.
    const blockedId = await fixture();
    const blocked = await prisma.booking.findUniqueOrThrow({ where: { id: blockedId } });
    const blocker = await control.connect();
    let held = false;
    let confirming: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const start = new Date(Date.now() + 5000);
      await prisma.availabilitySlot.update({
        where: { id: blocked.slotId },
        data: { startAtUtc: start, endAtUtc: new Date(start.getTime() + 3_600_000) },
      });
      await prisma.booking.update({ where: { id: blockedId }, data: { status: 'PENDING' } });
      await blocker.query('BEGIN');
      held = true;
      const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
        ?.pid;
      assert.ok(pid);
      await blocker.query('SELECT "id" FROM "Booking" WHERE "id" = $1 FOR UPDATE', [blockedId]);
      confirming = Promise.allSettled([
        bookings.confirmTutorBooking({ bookingId: blockedId, tutorUserId: tutorId }),
      ]);
      const timeout = Date.now() + 10_000;
      for (;;) {
        const waiting = await control.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))',
          [pid],
        );
        if ((waiting.rows[0]?.count ?? 0) > 0) break;
        assert.ok(Date.now() < timeout, 'Confirmation must reach the real row lock');
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, start.getTime() - Date.now() + 20)),
      );
      await blocker.query('COMMIT');
      held = false;
      const [outcome] = await confirming;
      assert.equal(
        outcome?.status,
        'rejected',
        'A pre-deadline request crossing the lock deadline must fail',
      );
      assert.equal(
        (await prisma.booking.findUniqueOrThrow({ where: { id: blockedId } })).status,
        'PENDING',
      );
      assert.equal(await prisma.notification.count({ where: { bookingId: blockedId } }), 0);
    } finally {
      if (held) await blocker.query('ROLLBACK');
      await confirming;
      blocker.release();
    }
    await prisma.availabilitySlot.update({
      where: { id: blocked.slotId },
      data: {
        startAtUtc: new Date(Date.now() + 28 * 3_600_000),
        endAtUtc: new Date(Date.now() + 29 * 3_600_000),
      },
    });
    process.stdout.write(
      'PASS confirmation crossing a real row-lock deadline rolls back to PENDING with zero notifications\n',
    );

    // Provider failure after the cutoff releases the attempt, then expires the unpaid booking.
    const failedDeadlineId = await fixture();
    await payments.create(failedDeadlineId, studentId);
    const failedBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: failedDeadlineId },
    });
    await prisma.availabilitySlot.update({
      where: { id: failedBooking.slotId },
      data: { startAtUtc: overdueStart, endAtUtc: new Date(overdueStart.getTime() + 3_600_000) },
    });
    await expiry.runOnce(new Date());
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: failedDeadlineId } })).status,
      'CONFIRMED',
    );
    const failedCharge = currentCharge(failedDeadlineId);
    failedCharge.status = 'expired';
    await webhook(failedCharge);
    await expiry.runOnce(new Date());
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: failedDeadlineId } })).status,
      'EXPIRED',
    );
    process.stdout.write(
      'PASS lesson-start deadline, capped QR, confirm/expiry race, protected active payment, late success and terminal expiry\n',
    );
    await prisma.availabilitySlot.update({
      where: { id: failedBooking.slotId },
      data: {
        startAtUtc: new Date(Date.now() + 30 * 3_600_000),
        endAtUtc: new Date(Date.now() + 31 * 3_600_000),
      },
    });
    const reschedules = module.get(RescheduleRequestsService);
    const movingId = await fixture();
    const original = await prisma.booking.findUniqueOrThrow({ where: { id: movingId } });
    async function targetSlot(startAtUtc: Date): Promise<string> {
      const slot = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: tutorId,
          startAtUtc,
          endAtUtc: new Date(startAtUtc.getTime() + 3_600_000),
        },
      });
      slotIds.push(slot.id);
      return slot.id;
    }
    const nearTarget = await targetSlot(new Date(Date.now() + 5 * 60_000));
    const pendingMove = await reschedules.create(studentId, Role.STUDENT, movingId, {
      targetSlotId: nearTarget,
    });
    await payments.create(movingId, studentId);
    assert.deepEqual((await reschedules.getCurrent(tutorId, movingId)).allowedActions, ['REJECT']);
    const moveSnapshot = await prisma.rescheduleRequest.findUniqueOrThrow({
      where: { id: pendingMove.requestId },
    });
    await assert.rejects(
      reschedules.approve(tutorId, pendingMove.requestId),
      (error: unknown) => error instanceof Error && error.message.includes('current payment'),
    );
    assert.deepEqual(
      await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: pendingMove.requestId } }),
      moveSnapshot,
    );
    assert.equal(
      (await prisma.booking.findUniqueOrThrow({ where: { id: movingId } })).slotId,
      original.slotId,
    );
    // Simulate the requested target passing while the bank result is still unresolved.
    await prisma.availabilitySlot.update({
      where: { id: nearTarget },
      data: { startAtUtc: new Date(Date.now() - 60_000) },
    });
    const movingCharge = currentCharge(movingId);
    movingCharge.status = 'successful';
    movingCharge.paid = true;
    movingCharge.paidAt = new Date();
    await webhook(movingCharge);
    await assert.rejects(
      reschedules.approve(tutorId, pendingMove.requestId),
      (error: unknown) => error instanceof Error && error.message.includes('in the future'),
    );
    const retained = await prisma.booking.findUniqueOrThrow({ where: { id: movingId } });
    assert.equal(retained.slotId, original.slotId);
    assert.equal(retained.paymentStatus, 'PAID');
    assert.equal(retained.paymentReference, movingCharge.id);
    await reschedules.withdraw(studentId, pendingMove.requestId);
    const futureTarget = await targetSlot(new Date(Date.now() + 2 * 3_600_000));
    const newMove = await reschedules.create(studentId, Role.STUDENT, movingId, {
      targetSlotId: futureTarget,
    });
    await reschedules.approve(tutorId, newMove.requestId);
    const movedPaid = await prisma.booking.findUniqueOrThrow({ where: { id: movingId } });
    assert.equal(movedPaid.slotId, futureTarget);
    assert.equal(movedPaid.paymentReference, movingCharge.id);
    process.stdout.write(
      'PASS unresolved payment blocks approval; late success pays the original class, and a new future target preserves that receipt\n',
    );
    const unpaidMoveId = await fixture();
    const unpaidStart = new Date(Date.now() + 5 * 60_000);
    await prisma.availabilitySlot.update({
      where: { id: nearTarget },
      data: { startAtUtc: unpaidStart, endAtUtc: new Date(unpaidStart.getTime() + 3_600_000) },
    });
    const unpaidMove = await reschedules.create(studentId, Role.STUDENT, unpaidMoveId, {
      targetSlotId: nearTarget,
    });
    await reschedules.approve(tutorId, unpaidMove.requestId);
    await payments.create(unpaidMoveId, studentId);
    assert.equal(currentCharge(unpaidMoveId).expiresAt?.getTime(), unpaidStart.getTime());
    process.stdout.write(
      'PASS unpaid reschedule to a near future target caps its new QR at the new lesson start\n',
    );
    creates = 0;

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
    const ready = currentCharge(bookingId);
    const notice = await prisma.notification.findUniqueOrThrow({
      where: {
        userId_eventKey: {
          userId: studentId,
          eventKey: `PAYMENT_QR_READY:${ready.attemptId}`,
        },
      },
    });
    await prisma.notification.update({ where: { id: notice.id }, data: { readAt: new Date() } });
    const readNotice = await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } });
    await Promise.all([payments.getStatus(bookingId, studentId), webhook(ready)]);
    assert.deepEqual(
      await prisma.notification.findMany({ where: { bookingId } }),
      [readNotice],
      'Reconciliation and webhook replay must preserve the original notification and read receipt',
    );
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

    const expiredId = await fixture();
    await payments.create(expiredId, studentId);
    const expiredCharge = currentCharge(expiredId);
    expiredCharge.status = 'expired';
    await payments.getStatus(expiredId, studentId);
    assert.equal(await prisma.notification.count({ where: { bookingId: expiredId } }), 1);
    await payments.create(expiredId, studentId);
    const renewed = currentCharge(expiredId);
    assert.notEqual(renewed.attemptId, expiredCharge.attemptId);
    const qrPrompts = await prisma.notification.findMany({ where: { bookingId: expiredId } });
    assert.deepEqual(
      qrPrompts.map((row) => row.eventKey).sort(),
      [expiredCharge, renewed].map((item) => `PAYMENT_QR_READY:${item.attemptId}`).sort(),
    );
    assert.ok(qrPrompts.every((row) => row.userId === studentId));

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
    await prisma.notification.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.paymentAttempt.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.rescheduleRequest.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.availabilitySlot.deleteMany({ where: { id: { in: slotIds } } });
    await prisma.teachingListing.deleteMany({ where: { id: listingId } });
    await prisma.tutorProfile.deleteMany({ where: { userId: tutorId } });
    await prisma.subject.deleteMany({ where: { id: subjectId } });
    await prisma.gradeLevel.deleteMany({ where: { id: gradeId } });
    await prisma.user.deleteMany({ where: { id: { in: [studentId, tutorId] } } });
    await control.end();
    await module.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Payment verification failed');
  process.exitCode = 1;
});

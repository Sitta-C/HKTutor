import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { OmiseRequestRejected, OmiseService } from '@infrastructure/payments/omise.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { PaymentsService } from '@modules/payments/payments.service';

import type { PaymentAttempt } from '@generated/prisma/client';
import type { OmiseCharge } from '@infrastructure/payments/omise.service';

const BOOKING_ID = '30000000-0000-4000-8000-000000000001';
const STUDENT_ID = '40000000-0000-4000-8000-000000000001';
const ATTEMPT_ID = '50000000-0000-4000-8000-000000000001';
const CHARGE_ID = 'chrg_test_example123';
const booking = () => ({
  id: BOOKING_ID,
  studentUserId: STUDENT_ID,
  status: 'CONFIRMED',
  paymentStatus: 'UNPAID',
  paymentPending: false,
  netAmount: new Prisma.Decimal('450.00'),
  subtotalAmount: new Prisma.Decimal('450.00'),
  discountAmount: new Prisma.Decimal(0),
  appliedCouponId: null,
  appliedCouponCode: null,
  appliedCouponPercent: null,
  currency: 'THB',
  paidAt: null,
  mockReference: null,
  paymentReference: null,
});
const attempt = (): PaymentAttempt => ({
  id: ATTEMPT_ID,
  bookingId: BOOKING_ID,
  amount: new Prisma.Decimal('450.00'),
  appliedCouponId: null,
  appliedCouponCode: null,
  appliedCouponPercent: null,
  currency: 'THB',
  status: 'CREATING',
  chargeId: null,
  qrCodeUrl: null,
  expiresAt: null,
  paidAt: null,
  failureCode: null,
  createdAt: new Date(Date.now() - 60_000),
  updatedAt: new Date(),
});
const charge = (): OmiseCharge => ({
  id: CHARGE_ID,
  amount: 45000,
  currency: 'THB',
  bookingId: BOOKING_ID,
  attemptId: ATTEMPT_ID,
  status: 'pending',
  paid: false,
  paidAt: null,
  expiresAt: new Date(Date.now() + 600_000),
  qrCodeUrl: 'https://api.omise.co/qr.svg',
  failureCode: null,
});

describe('PaymentsService', () => {
  let service: PaymentsService;
  const db = {
    booking: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    coupon: { findUnique: jest.fn() },
    couponReservation: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    couponUse: { findUnique: jest.fn(), count: jest.fn() },
    notification: { createMany: jest.fn() },
    $executeRaw: jest.fn(),
    paymentAttempt: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const transaction = jest.fn();
  const omise = {
    assertEnabled: jest.fn(),
    createCharge: jest.fn<
      ReturnType<OmiseService['createCharge']>,
      Parameters<OmiseService['createCharge']>
    >(),
    retrieveCharge: jest.fn(),
    findCharge: jest.fn(),
  };

  function createdAttemptId(index = 0): string {
    const id = omise.createCharge.mock.calls[index]?.[0].attemptId;
    if (!id) throw new Error('Expected a created charge');
    return id;
  }

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-13T09:00:00.000Z'));
    jest.resetAllMocks();
    transaction.mockImplementation((run: (tx: typeof db) => Promise<unknown>) => run(db));
    db.booking.findUnique.mockResolvedValue(booking());
    db.booking.updateMany.mockResolvedValue({ count: 1 });
    db.paymentAttempt.create.mockImplementation(({ data }: { data: { id: string } }) => {
      const current = { ...attempt(), id: data.id };
      db.paymentAttempt.findUnique.mockResolvedValue(current);
      return Promise.resolve(current);
    });
    db.paymentAttempt.findFirst.mockResolvedValue(null);
    db.paymentAttempt.findUnique.mockResolvedValue(attempt());
    omise.createCharge.mockImplementation((input: { attemptId: string }) =>
      Promise.resolve({ ...charge(), attemptId: input.attemptId }),
    );
    omise.retrieveCharge.mockResolvedValue(charge());
    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        NotificationEventsService,
        { provide: PrismaService, useValue: { ...db, $transaction: transaction } },
        { provide: OmiseService, useValue: omise },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes the payment prompt in the same transaction as a newly usable QR', async () => {
    await service.create(BOOKING_ID, STUDENT_ID);
    const attemptId = createdAttemptId();
    expect(db.notification.createMany).toHaveBeenCalledWith({
      data: {
        bookingId: BOOKING_ID,
        userId: STUDENT_ID,
        eventType: 'PAYMENT_QR_READY',
        eventKey: `PAYMENT_QR_READY:${attemptId}`,
        title: 'Payment QR ready',
        body: expect.any(String) as unknown,
      },
      skipDuplicates: true,
    });
    expect(db.paymentAttempt.update.mock.invocationCallOrder[0]).toBeLessThan(
      db.notification.createMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('prompts again for a new attempt after expiry, without notifying on expiry itself', async () => {
    await service.create(BOOKING_ID, STUDENT_ID);
    const firstId = createdAttemptId();
    const saved = { ...attempt(), id: firstId, status: 'PENDING', chargeId: CHARGE_ID };
    db.paymentAttempt.findUnique.mockResolvedValue(saved);
    db.paymentAttempt.findFirst.mockResolvedValue(saved);
    omise.retrieveCharge.mockResolvedValue({
      ...charge(),
      attemptId: firstId,
      status: 'expired',
    });
    await service.getStatus(BOOKING_ID, STUDENT_ID);
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);

    await service.create(BOOKING_ID, STUDENT_ID);
    const secondId = createdAttemptId(1);
    expect(secondId).not.toBe(firstId);
    expect(db.notification.createMany).toHaveBeenCalledTimes(2);
    expect(db.notification.createMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventKey: `PAYMENT_QR_READY:${secondId}`,
        }) as unknown,
      }),
    );
  });

  it('recovers the QR prompt on a status read after a lost create response', async () => {
    omise.createCharge.mockRejectedValueOnce(new ServiceUnavailableException('timeout'));
    await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow();
    expect(db.notification.createMany).not.toHaveBeenCalled();
    const attemptId = createdAttemptId();
    db.paymentAttempt.findFirst.mockResolvedValue({ ...attempt(), id: attemptId });
    omise.findCharge.mockResolvedValue({ ...charge(), attemptId });
    await service.getStatus(BOOKING_ID, STUDENT_ID);
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    expect(omise.createCharge).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 'failed' },
    { status: 'expired' },
    { status: 'successful', paid: true, paidAt: new Date('2026-11-13T09:00:00.000Z') },
    { qrCodeUrl: null },
    { expiresAt: null },
    { expiresAt: new Date('2026-11-13T09:00:00.000Z') },
  ])('does not prompt for a terminal or unusable QR: %j', async (change) => {
    omise.createCharge.mockImplementation((input: { attemptId: string }) =>
      Promise.resolve({ ...charge(), attemptId: input.attemptId, ...change }),
    );
    await service.create(BOOKING_ID, STUDENT_ID);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('propagates notification failure so QR persistence can roll back and be recovered', async () => {
    db.notification.createMany.mockRejectedValueOnce(new Error('Notification write failed'));
    await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow(
      'Notification write failed',
    );
    expect(db.paymentAttempt.update).toHaveBeenCalled();
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });

  it('claims the booking atomically and charges only the stored amount', async () => {
    await service.create(BOOKING_ID, STUDENT_ID);
    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { paymentPending: true },
    });
    expect(omise.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 45000, bookingId: BOOKING_ID }),
    );
    expect(db.paymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', chargeId: CHARGE_ID }) as unknown,
      }),
    );
  });

  it('returns the same stored money and coupon snapshot on status reads', async () => {
    db.booking.findUnique.mockResolvedValue({
      ...booking(),
      appliedCouponId: STUDENT_ID,
      appliedCouponCode: 'ORIGINAL10',
      appliedCouponPercent: 10,
      discountAmount: new Prisma.Decimal(45),
      netAmount: new Prisma.Decimal(405),
    });
    const result = await service.getStatus(BOOKING_ID, STUDENT_ID);
    expect(result).toMatchObject({
      subtotalAmount: '450.00',
      discountAmount: '45.00',
      netAmount: '405.00',
      currency: 'THB',
      coupon: { id: STUDENT_ID, code: 'ORIGINAL10', percent: 10 },
    });
  });

  it('rejects a missing applied coupon', async () => {
    db.booking.findUnique.mockResolvedValue({ ...booking(), appliedCouponId: STUDENT_ID });
    await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow(ConflictException);
    expect(omise.createCharge).not.toHaveBeenCalled();
  });

  it('does not call Omise when ownership or booking state is invalid', async () => {
    db.booking.findUnique.mockResolvedValueOnce(null);
    await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow(NotFoundException);
    await expect(service.create(BOOKING_ID, 'other')).rejects.toThrow(ForbiddenException);
    db.booking.findUnique.mockResolvedValueOnce({ ...booking(), status: 'CANCELED' });
    await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow(ConflictException);
    expect(omise.createCharge).not.toHaveBeenCalled();
  });

  it.each(['19.99', '150000.01'])(
    'rejects a booking outside provider limits: %s',
    async (amount) => {
      db.booking.findUnique.mockResolvedValue({
        ...booking(),
        netAmount: new Prisma.Decimal(amount),
      });
      await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow(ConflictException);
    },
  );

  it('resumes an existing active attempt without creating another charge', async () => {
    db.booking.findUnique.mockResolvedValue({ ...booking(), paymentPending: true });
    db.paymentAttempt.findFirst.mockResolvedValue({
      ...attempt(),
      status: 'PENDING',
      chargeId: CHARGE_ID,
    });
    await service.create(BOOKING_ID, STUDENT_ID);
    expect(db.paymentAttempt.create).not.toHaveBeenCalled();
    expect(omise.createCharge).not.toHaveBeenCalled();
  });

  it('keeps an uncertain creation locked and recovers it by metadata on a later read', async () => {
    omise.createCharge.mockRejectedValueOnce(new ServiceUnavailableException('timeout'));
    await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(db.booking.update).toHaveBeenCalledTimes(1);
    expect(db.paymentAttempt.updateMany).not.toHaveBeenCalled();
    db.paymentAttempt.findFirst.mockResolvedValue(attempt());
    omise.findCharge.mockResolvedValueOnce(charge());
    await service.getStatus(BOOKING_ID, STUDENT_ID);
    expect(omise.findCharge).toHaveBeenCalledWith(ATTEMPT_ID, expect.any(Date));
    expect(omise.createCharge).toHaveBeenCalledTimes(1);
  });

  it('releases the claim only after a definitive creation rejection', async () => {
    omise.createCharge.mockRejectedValueOnce(new OmiseRequestRejected());
    db.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.create(BOOKING_ID, STUDENT_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(db.booking.updateMany).toHaveBeenLastCalledWith({
      where: { id: BOOKING_ID, paymentStatus: 'UNPAID' },
      data: { paymentPending: false },
    });
  });

  it('verifies a webhook using the provider and makes duplicate/out-of-order delivery a no-op', async () => {
    const paidAt = new Date('2030-01-01T00:00:00Z');
    omise.retrieveCharge.mockResolvedValue({
      ...charge(),
      status: 'successful',
      paid: true,
      paidAt,
    });
    const event = {
      object: 'event',
      livemode: false,
      key: 'charge.complete',
      data: { id: CHARGE_ID, status: 'failed' },
    };
    await service.webhook(event);
    expect(db.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { paymentPending: false, paymentStatus: 'PAID', paidAt, paymentReference: CHARGE_ID },
      }),
    );
    db.paymentAttempt.findUnique.mockResolvedValue({
      ...attempt(),
      status: 'SUCCESSFUL',
      chargeId: CHARGE_ID,
      paidAt,
    });
    db.booking.updateMany.mockClear();
    db.paymentAttempt.update.mockClear();
    omise.retrieveCharge.mockResolvedValue(charge());
    await service.webhook(event);
    expect(db.booking.updateMany).not.toHaveBeenCalled();
    expect(db.paymentAttempt.update).not.toHaveBeenCalled();
  });

  it('ignores a signed event for an unrelated application without fetching a charge', async () => {
    db.paymentAttempt.findUnique.mockResolvedValue(null);
    await service.webhook({
      object: 'event',
      livemode: false,
      key: 'charge.create',
      data: { id: 'chrg_test_unrelated' },
    });
    expect(omise.retrieveCharge).not.toHaveBeenCalled();
  });

  it.each([
    { amount: 44999 },
    { currency: 'USD' },
    { bookingId: STUDENT_ID },
    { id: 'chrg_test_other' },
    { attemptId: STUDENT_ID },
  ])('rejects a mismatched charge: %j', async (change) => {
    db.paymentAttempt.findFirst.mockResolvedValue({
      ...attempt(),
      status: 'PENDING',
      chargeId: CHARGE_ID,
    });
    db.paymentAttempt.findUnique.mockResolvedValue({
      ...attempt(),
      status: 'PENDING',
      chargeId: CHARGE_ID,
    });
    omise.retrieveCharge.mockResolvedValue({ ...charge(), ...change });
    await expect(service.getStatus(BOOKING_ID, STUDENT_ID)).rejects.toThrow(ConflictException);
    expect(db.paymentAttempt.update).not.toHaveBeenCalled();
  });

  it.each(['failed', 'expired'] as const)(
    'releases an active booking after provider confirms %s',
    async (status) => {
      db.paymentAttempt.findFirst.mockResolvedValue({
        ...attempt(),
        status: 'PENDING',
        chargeId: CHARGE_ID,
      });
      omise.retrieveCharge.mockResolvedValue({ ...charge(), status });
      await service.getStatus(BOOKING_ID, STUDENT_ID);
      expect(db.booking.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { paymentPending: false } }),
      );
    },
  );

  it('rolls back reconciliation when the booking cannot transition', async () => {
    db.paymentAttempt.findFirst.mockResolvedValue({
      ...attempt(),
      status: 'PENDING',
      chargeId: CHARGE_ID,
    });
    omise.retrieveCharge.mockResolvedValue({
      ...charge(),
      status: 'successful',
      paid: true,
      paidAt: new Date(),
    });
    db.booking.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.getStatus(BOOKING_ID, STUDENT_ID)).rejects.toThrow(ConflictException);
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { BookingsService } from '@modules/bookings/bookings.service';

import type { TestingModule } from '@nestjs/testing';

type DatabaseError = Error & { code: string; meta?: { code?: string; target?: string[] } };

type TransactionCallback = (tx: {
  booking: { findUniqueOrThrow: jest.Mock; updateMany: jest.Mock };
}) => Promise<unknown>;

const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const STUDENT_ID = '6bb01222-1fce-4bc3-a69d-3d90db2fdf57';
const OTHER_STUDENT_ID = '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857';
const PAID_AT = new Date('2026-10-09T09:04:31.001Z');

function matchingType(type: typeof Date): unknown {
  return expect.any(type);
}

const databaseError = (code: string, target?: string[]): DatabaseError => {
  const error = new Error(`database reported ${code}`) as DatabaseError;
  error.code = code;
  if (target) error.meta = { target };
  return error;
};

describe('BookingsService mock payment', () => {
  let service: BookingsService;

  const prisma = {
    $transaction: jest.fn(),
    booking: { findUnique: jest.fn() },
  };

  const payableBooking = (studentUserId = STUDENT_ID, netAmount = '450.00') => ({
    netAmount: new Prisma.Decimal(netAmount),
    paymentStatus: PaymentStatus.UNPAID,
    status: BookingStatus.CONFIRMED,
    studentUserId,
  });

  const payment = (overrides: { amount?: string; reference?: string } = {}) => ({
    amount: overrides.amount ?? '450.00',
    bookingId: BOOKING_ID,
    reference: overrides.reference ?? 'DEMO-7F3A91',
    studentUserId: STUDENT_ID,
  });

  const stubTransaction = (options: { paymentCount?: number; storedReference?: string } = {}) => {
    const updateMany = jest.fn().mockResolvedValue({ count: options.paymentCount ?? 1 });
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: BOOKING_ID,
      mockReference: options.storedReference ?? 'DEMO-7F3A91',
      netAmount: new Prisma.Decimal('450.00'),
      paidAt: PAID_AT,
      paymentStatus: PaymentStatus.PAID,
    });

    prisma.$transaction.mockImplementation(async (callback: TransactionCallback) =>
      callback({ booking: { findUniqueOrThrow, updateMany } }),
    );

    return { findUniqueOrThrow, updateMany };
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [BookingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(BookingsService);
  });

  it('records the payment once and reports the stored amount and timestamp', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking());
    const { updateMany } = stubTransaction();

    await expect(service.createMockPayment(payment())).resolves.toEqual({
      amount: '450.00',
      bookingId: BOOKING_ID,
      paidAt: PAID_AT.toISOString(),
      paymentStatus: PaymentStatus.PAID,
      reference: 'DEMO-7F3A91',
    });
    // Only an unpaid, confirmed booking owned by this student can be written.
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        mockReference: 'DEMO-7F3A91',
        paidAt: matchingType(Date),
        paymentStatus: PaymentStatus.PAID,
      },
      where: {
        id: BOOKING_ID,
        paymentStatus: PaymentStatus.UNPAID,
        status: BookingStatus.CONFIRMED,
        studentUserId: STUDENT_ID,
      },
    });
  });

  it('answers 404 for a missing booking', async () => {
    prisma.booking.findUnique.mockResolvedValue(null);

    await expect(service.createMockPayment(payment())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers 403 for a booking owned by another student', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking(OTHER_STUDENT_ID));

    await expect(service.createMockPayment(payment())).rejects.toMatchObject({
      response: { code: 'BOOKING_NOT_OWNED', statusCode: 403 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    BookingStatus.PENDING,
    BookingStatus.CANCELED,
    BookingStatus.COMPLETED,
    BookingStatus.EXPIRED,
  ])('answers 409 BOOKING_NOT_PAYABLE for a %s booking', async (status) => {
    prisma.booking.findUnique.mockResolvedValue({ ...payableBooking(), status });

    await expect(service.createMockPayment(payment())).rejects.toMatchObject({
      response: { code: 'BOOKING_NOT_PAYABLE', statusCode: 409 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers 409 BOOKING_ALREADY_PAID for a paid booking', async () => {
    prisma.booking.findUnique.mockResolvedValue({
      ...payableBooking(),
      paymentStatus: PaymentStatus.PAID,
    });

    await expect(service.createMockPayment(payment())).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers 400 when the declared amount differs from the stored amount', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking(STUDENT_ID, '450.00'));

    await expect(service.createMockPayment(payment({ amount: '400.00' }))).rejects.toMatchObject({
      response: {
        code: 'BOOKING_PAYMENT_AMOUNT_MISMATCH',
        details: { expectedAmount: '450.00' },
        statusCode: 400,
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('compares the amount numerically rather than as text', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking(STUDENT_ID, '450.0'));
    stubTransaction();

    await expect(service.createMockPayment(payment())).resolves.toMatchObject({
      paymentStatus: PaymentStatus.PAID,
    });
  });

  it('answers 409 and reads nothing back when a concurrent payment won', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking());
    const { findUniqueOrThrow } = stubTransaction({ paymentCount: 0 });

    await expect(service.createMockPayment(payment())).rejects.toMatchObject({
      response: { code: 'BOOKING_PAYMENT_CONFLICT', statusCode: 409 },
    });
    // The transaction aborts before the read-back, so no partial payment is ever reported.
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('answers 409 MOCK_REFERENCE_TAKEN when the reference belongs to another booking', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking());
    prisma.$transaction.mockRejectedValue(databaseError('P2002', ['Booking_mockReference_key']));

    await expect(
      service.createMockPayment(payment({ reference: 'DEMO-TAKEN' })),
    ).rejects.toMatchObject({ response: { code: 'MOCK_REFERENCE_TAKEN', statusCode: 409 } });
  });

  it('answers 409 BOOKING_PAYMENT_CONFLICT for another database conflict', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking());
    prisma.$transaction.mockRejectedValue(databaseError('P2003'));

    await expect(service.createMockPayment(payment())).rejects.toMatchObject({
      response: { code: 'BOOKING_PAYMENT_CONFLICT', statusCode: 409 },
    });
  });

  it('rethrows an unrelated failure instead of reporting a conflict', async () => {
    prisma.booking.findUnique.mockResolvedValue(payableBooking());
    const failure = new Error('connection reset');
    prisma.$transaction.mockRejectedValue(failure);

    await expect(service.createMockPayment(payment())).rejects.toBe(failure);
  });
});

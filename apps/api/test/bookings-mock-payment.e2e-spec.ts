import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Prisma, Role } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_STUDENT_ID = '30000000-0000-4000-8000-000000000002';
const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const PAID_AT = new Date('2026-10-09T09:04:31.001Z');
const PAYMENT = { amount: '450.00', reference: 'DEMO-7F3A91' };

function matchingType(type: typeof Date): unknown {
  return expect.any(type);
}

function matchingObject(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value);
}

describe('Student mock payment (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const bookingFindUnique = jest.fn();
  const bookingUpdateMany = jest.fn();
  const bookingFindUniqueOrThrow = jest.fn();
  const transaction = jest.fn();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        BookingsService,
        JwtAuthGuard,
        ResourceOwnershipGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: {
            $transaction: transaction,
            authSession: { findUnique: authSessionFindUnique },
            booking: { findUnique: bookingFindUnique },
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.resetAllMocks());

  it('returns 401 without an access token', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/bookings/me/${BOOKING_ID}/mock-payment`)
      .send(PAYMENT)
      .expect(401);

    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    expect(bookingFindUnique).not.toHaveBeenCalled();
  });

  it('returns 403 for a tutor', async () => {
    authenticateAs(Role.TUTOR);

    const response = await paymentRequest().send(PAYMENT).expect(403);

    expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(bookingFindUnique).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_UUID for a malformed booking ID', async () => {
    authenticateAs(Role.STUDENT);

    const response = await request(app.getHttpServer())
      .post('/api/v1/bookings/me/not-a-uuid/mock-payment')
      .set('Authorization', 'Bearer signed-token')
      .send(PAYMENT)
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'INVALID_UUID',
      message: 'bookingId must be a valid UUID',
      statusCode: 400,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank reference', { amount: '450.00', reference: '   ' }],
    ['a missing reference', { amount: '450.00' }],
    ['a loose amount', { amount: '450', reference: 'DEMO-1' }],
    ['a missing amount', { reference: 'DEMO-1' }],
    ['a card number field', { ...PAYMENT, cardNumber: '4111111111111111' }],
    ['a bank account field', { ...PAYMENT, bankAccount: '1234567890' }],
  ])('returns 400 for %s', async (_description, body) => {
    authenticateAs(Role.STUDENT);
    // Guards run before the body is validated, so ownership has to pass for the pipe to be reached.
    bookingFindUnique.mockResolvedValue(payableBooking());

    const response = await paymentRequest().send(body).expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the booking does not exist', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(null);

    const response = await paymentRequest().send(PAYMENT).expect(404);

    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND', statusCode: 404 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns 403 for another student's booking", async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking({ studentUserId: OTHER_STUDENT_ID }));

    const response = await paymentRequest().send(PAYMENT).expect(403);

    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_OWNED', statusCode: 403 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 409 for a booking that is still pending', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking({ status: BookingStatus.PENDING }));

    const response = await paymentRequest().send(PAYMENT).expect(409);

    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_PAYABLE', statusCode: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 409 for a booking that is already paid', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking({ paymentStatus: PaymentStatus.PAID }));

    const response = await paymentRequest().send(PAYMENT).expect(409);

    expect(response.body).toMatchObject({ code: 'BOOKING_ALREADY_PAID', statusCode: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 400 and keeps the payment state when the amount does not match', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking());

    const response = await paymentRequest()
      .send({ amount: '400.00', reference: 'DEMO-1' })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'BOOKING_PAYMENT_AMOUNT_MISMATCH',
      details: { expectedAmount: '450.00' },
      statusCode: 400,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 200 and records the payment once for a confirmed unpaid booking', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking());
    stubPayment({});

    const response = await paymentRequest().send(PAYMENT).expect(200);

    expect(response.body).toEqual({
      amount: '450.00',
      bookingId: BOOKING_ID,
      paidAt: PAID_AT.toISOString(),
      paymentStatus: PaymentStatus.PAID,
      reference: PAYMENT.reference,
    });
    expect(bookingUpdateMany).toHaveBeenCalledWith({
      data: {
        mockReference: PAYMENT.reference,
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

  it('trims the reference before storing it', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking());
    stubPayment({});

    await paymentRequest().send({ amount: '450.00', reference: '  DEMO-7F3A91  ' }).expect(200);

    expect(bookingUpdateMany).toHaveBeenCalledWith(
      matchingObject({ data: matchingObject({ mockReference: 'DEMO-7F3A91' }) }),
    );
  });

  it('returns 409 without reading the booking back when a concurrent payment won', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking());
    stubPayment({ paymentCount: 0 });

    const response = await paymentRequest().send(PAYMENT).expect(409);

    expect(response.body).toMatchObject({ code: 'BOOKING_PAYMENT_CONFLICT', statusCode: 409 });
    expect(bookingFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('returns 409 when the reference is already recorded for another booking', async () => {
    authenticateAs(Role.STUDENT);
    bookingFindUnique.mockResolvedValue(payableBooking());
    const duplicate = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['Booking_mockReference_key'] },
    });
    transaction.mockRejectedValue(duplicate);

    const response = await paymentRequest().send(PAYMENT).expect(409);

    expect(response.body).toMatchObject({ code: 'MOCK_REFERENCE_TAKEN', statusCode: 409 });
  });

  function paymentRequest(): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/me/${BOOKING_ID}/mock-payment`)
      .set('Authorization', 'Bearer signed-token');
  }

  function payableBooking(
    overrides: {
      netAmount?: string;
      paymentStatus?: PaymentStatus;
      status?: BookingStatus;
      studentUserId?: string;
    } = {},
  ) {
    return {
      netAmount: new Prisma.Decimal(overrides.netAmount ?? '450.00'),
      paymentStatus: overrides.paymentStatus ?? PaymentStatus.UNPAID,
      status: overrides.status ?? BookingStatus.CONFIRMED,
      studentUserId: overrides.studentUserId ?? STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    };
  }

  function stubPayment(options: { paymentCount?: number }): void {
    bookingUpdateMany.mockResolvedValue({ count: options.paymentCount ?? 1 });
    bookingFindUniqueOrThrow.mockResolvedValue({
      id: BOOKING_ID,
      mockReference: PAYMENT.reference,
      netAmount: new Prisma.Decimal('450.00'),
      paidAt: PAID_AT,
      paymentStatus: PaymentStatus.PAID,
    });
    transaction.mockImplementation(
      async (callback: (tx: { booking: Record<string, jest.Mock> }) => Promise<unknown>) =>
        callback({
          booking: {
            findUniqueOrThrow: bookingFindUniqueOrThrow,
            updateMany: bookingUpdateMany,
          },
        }),
    );
  }

  function authenticateAs(role: Role): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: STUDENT_ID });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: 'student@example.com',
        emailVerifiedAt: new Date(),
        id: STUDENT_ID,
        role,
      },
      userId: STUDENT_ID,
    });
  }
});

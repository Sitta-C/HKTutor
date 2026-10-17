import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_STUDENT_ID = '30000000-0000-4000-8000-000000000002';
const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_TUTOR_ID = '20000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const NOW = new Date('2026-10-15T03:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const SECOND = 1000;

// Only Date is frozen; real timers keep the HTTP server and supertest running.
const FROZEN_DATE_ONLY = {
  doNotFake: [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
  ],
  now: NOW,
} satisfies Parameters<typeof jest.useFakeTimers>[0];

describe('Booking cancellation (S2-T24 e2e)', () => {
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
        { provide: NotificationEventsService, useValue: { write: jest.fn() } },
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

  beforeEach(() => {
    jest.useFakeTimers(FROZEN_DATE_ONLY);
    transaction.mockImplementation((run: (tx: unknown) => unknown) =>
      run({
        booking: {
          findUnique: bookingFindUnique,
          findUniqueOrThrow: bookingFindUniqueOrThrow,
          updateMany: bookingUpdateMany,
        },
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  describe('the inclusive 24-hour cutoff, with the clock frozen', () => {
    it.each([
      ['exactly 24 hours', 24 * HOUR],
      ['24 hours and 1 second', 24 * HOUR + SECOND],
    ])('cancels a class that starts in %s and returns the contract body', async (_label, lead) => {
      authenticateAs(Role.STUDENT, STUDENT_ID);
      stubBooking({ startsIn: lead });
      stubSuccessfulUpdate();

      const response = await cancel().send({ reason: '  School event  ' }).expect(200);

      expect(response.body).toEqual({
        bookingId: BOOKING_ID,
        canceledAt: NOW.toISOString(),
        status: BookingStatus.CANCELED,
      });
      expect(bookingUpdateMany).toHaveBeenCalledTimes(1);
      expect(bookingUpdateMany).toHaveBeenCalledWith({
        data: {
          canceledAt: NOW,
          canceledById: STUDENT_ID,
          cancellationReason: 'School event',
          status: BookingStatus.CANCELED,
        },
        where: {
          id: BOOKING_ID,
          paymentStatus: PaymentStatus.UNPAID,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        },
      });
    });

    it.each([
      ['24 hours minus 1 second', 24 * HOUR - SECOND],
      ['2 hours, as in US5-1', 2 * HOUR],
      ['the past', -HOUR],
    ])('returns 409 for a class that starts in %s and changes nothing', async (_label, lead) => {
      authenticateAs(Role.STUDENT, STUDENT_ID);
      stubBooking({ startsIn: lead });

      const response = await cancel().send({ reason: 'School event' }).expect(409);

      expect(response.body).toMatchObject({
        code: 'BOOKING_EXCEED_CANCEL_RANGE',
        statusCode: 409,
      });
      expect(bookingUpdateMany).not.toHaveBeenCalled();
    });
  });

  it('lets the owning tutor cancel and records the tutor as the canceler', async () => {
    authenticateAs(Role.TUTOR, TUTOR_ID);
    stubBooking({ startsIn: 48 * HOUR });
    stubSuccessfulUpdate();

    await cancel().send({ reason: 'Tutor is unavailable' }).expect(200);

    const update = (
      bookingUpdateMany.mock.calls as unknown as Array<[{ data: { canceledById: string } }]>
    )[0]?.[0];
    expect(update?.data.canceledById).toBe(TUTOR_ID);
  });

  it.each([
    ['a missing reason', {}],
    ['a blank reason', { reason: '   ' }],
    ['a reason that is not a string', { reason: 42 }],
  ])('returns 400 for %s and changes nothing', async (_label, body) => {
    authenticateAs(Role.STUDENT, STUDENT_ID);
    stubBooking({ startsIn: 48 * HOUR });

    const response = await cancel().send(body).expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
    expect(bookingUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['a paid booking', { paymentStatus: PaymentStatus.PAID }, 'BOOKING_ALREADY_PAID'],
    ['a completed booking', { status: BookingStatus.COMPLETED }, 'BOOKING_ALREADY_COMPLETED'],
    ['a canceled booking', { status: BookingStatus.CANCELED }, 'BOOKING_ALREADY_CANCELED'],
    ['an expired booking', { status: BookingStatus.EXPIRED }, 'BOOKING_ALREADY_EXPIRED'],
  ])('returns 409 for %s and changes nothing', async (_label, overrides, code) => {
    authenticateAs(Role.STUDENT, STUDENT_ID);
    stubBooking({ startsIn: 48 * HOUR, ...overrides });

    const response = await cancel().send({ reason: 'School event' }).expect(409);

    expect(response.body).toMatchObject({ code, statusCode: 409 });
    expect(bookingUpdateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent request changed the booking first', async () => {
    authenticateAs(Role.STUDENT, STUDENT_ID);
    stubBooking({ startsIn: 48 * HOUR });
    bookingUpdateMany.mockResolvedValue({ count: 0 });

    const response = await cancel().send({ reason: 'School event' }).expect(409);

    expect(response.body).toMatchObject({ code: 'BOOKING_TRANSITION_CONFLICT', statusCode: 409 });
    expect(bookingFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  describe('who may cancel', () => {
    it.each([
      ['another student', Role.STUDENT, OTHER_STUDENT_ID],
      ['another tutor', Role.TUTOR, OTHER_TUTOR_ID],
    ])('returns 403 to %s and changes nothing', async (_label, role, userId) => {
      authenticateAs(role, userId);
      stubBooking({ startsIn: 48 * HOUR });

      const response = await cancel().send({ reason: 'School event' }).expect(403);

      expect(response.body).toMatchObject({ code: 'BOOKING_NOT_OWNED', statusCode: 403 });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns 403 to an admin without loading the booking', async () => {
      authenticateAs(Role.ADMIN, ADMIN_ID);

      const response = await cancel().send({ reason: 'School event' }).expect(403);

      expect(response.body).toMatchObject({ code: 'BOOKING_NOT_OWNED', statusCode: 403 });
      expect(bookingFindUnique).not.toHaveBeenCalled();
    });

    it('returns 404 for a booking that does not exist', async () => {
      authenticateAs(Role.STUDENT, STUDENT_ID);
      bookingFindUnique.mockResolvedValue(null);

      const response = await cancel().send({ reason: 'School event' }).expect(404);

      expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND', statusCode: 404 });
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns 401 without an access token', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${BOOKING_ID}/cancel`)
        .send({ reason: 'School event' })
        .expect(401);

      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
      expect(bookingFindUnique).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_UUID for a malformed booking ID', async () => {
      authenticateAs(Role.STUDENT, STUDENT_ID);

      const response = await request(app.getHttpServer())
        .post('/api/v1/bookings/not-a-uuid/cancel')
        .set('Authorization', 'Bearer signed-token')
        .send({ reason: 'School event' })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'INVALID_UUID', statusCode: 400 });
      expect(bookingFindUnique).not.toHaveBeenCalled();
    });
  });

  function cancel(): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/${BOOKING_ID}/cancel`)
      .set('Authorization', 'Bearer signed-token');
  }

  // The ownership guard and the service both load the booking; each reads the fields it selects.
  function stubBooking(options: {
    startsIn: number;
    paymentStatus?: PaymentStatus;
    status?: BookingStatus;
  }): void {
    bookingFindUnique.mockResolvedValue({
      id: BOOKING_ID,
      paymentStatus: options.paymentStatus ?? PaymentStatus.UNPAID,
      slot: { startAtUtc: new Date(NOW.getTime() + options.startsIn) },
      status: options.status ?? BookingStatus.CONFIRMED,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    });
  }

  function stubSuccessfulUpdate(): void {
    bookingUpdateMany.mockResolvedValue({ count: 1 });
    bookingFindUniqueOrThrow.mockResolvedValue({
      canceledAt: NOW,
      id: BOOKING_ID,
      status: BookingStatus.CANCELED,
    });
  }

  function authenticateAs(role: Role, id: string): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: id });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(NOW.getTime() + HOUR),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: `${role.toLowerCase()}@example.com`,
        emailVerifiedAt: NOW,
        id,
        role,
      },
      userId: id,
    });
  }
});

import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role } from '@generated/prisma/client';
import { BookingStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_TUTOR_ID = '20000000-0000-4000-8000-000000000002';
const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const SLOT_ID = '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5';
const CANCELED_AT = new Date('2026-10-04T09:04:31.001Z');

describe('Tutor booking confirm and reject (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const bookingFindUnique = jest.fn();
  const bookingFindMany = jest.fn();
  const bookingUpdateMany = jest.fn();
  const bookingFindUniqueOrThrow = jest.fn();
  const bookingCount = jest.fn();
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
            booking: {
              count: bookingCount,
              findMany: bookingFindMany,
              findUnique: bookingFindUnique,
            },
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
      .post(`/api/v1/bookings/tutor/${BOOKING_ID}/confirm`)
      .send({})
      .expect(401);

    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    expect(bookingFindUnique).not.toHaveBeenCalled();
  });

  it('returns 403 for a student', async () => {
    authenticateAs(Role.STUDENT);

    const response = await actionRequest('confirm').send({}).expect(403);

    expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(bookingFindUnique).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_UUID for a malformed booking ID', async () => {
    authenticateAs(Role.TUTOR);

    const response = await request(app.getHttpServer())
      .post('/api/v1/bookings/tutor/not-a-uuid/reject')
      .set('Authorization', 'Bearer signed-token')
      .send({})
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'INVALID_UUID',
      message: 'bookingId must be a valid UUID',
      statusCode: 400,
    });
    expect(bookingFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank reason', { reason: '   ' }],
    ['an unknown field', { refund: true }],
  ])('returns 400 for %s', async (_description, body) => {
    authenticateAs(Role.TUTOR);
    // Guards run before the body is validated, so the booking has to pass the ownership check
    // first for the request to reach the validation pipe at all.
    bookingFindUnique.mockResolvedValue({
      status: BookingStatus.PENDING,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    });

    const response = await actionRequest('reject').send(body).expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the booking does not exist', async () => {
    authenticateAs(Role.TUTOR);
    bookingFindUnique.mockResolvedValue(null);

    const response = await actionRequest('confirm').send({}).expect(404);

    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND', statusCode: 404 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("returns 403 for another tutor's booking", async () => {
    authenticateAs(Role.TUTOR);
    bookingFindUnique.mockResolvedValue({
      status: BookingStatus.PENDING,
      studentUserId: STUDENT_ID,
      tutorProfileId: OTHER_TUTOR_ID,
    });

    const response = await actionRequest('reject').send({}).expect(403);

    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_OWNED', statusCode: 403 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('confirms a pending booking and keeps the slot reserved', async () => {
    authenticateAs(Role.TUTOR);
    bookingFindUnique.mockResolvedValue({
      status: BookingStatus.PENDING,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    });
    stubTransition({ activeBookings: 1, status: BookingStatus.CONFIRMED });

    const response = await actionRequest('confirm').send({ note: 'See you in class.' }).expect(200);

    expect(response.body).toEqual({
      bookingId: BOOKING_ID,
      canceledAt: null,
      slotStatus: 'RESERVED',
      status: BookingStatus.CONFIRMED,
    });
    expect(bookingUpdateMany).toHaveBeenCalledWith({
      data: { status: BookingStatus.CONFIRMED },
      where: { id: BOOKING_ID, status: BookingStatus.PENDING, tutorProfileId: TUTOR_ID },
    });
  });

  it('rejects a pending booking, stores the cancellation fields and releases the slot', async () => {
    authenticateAs(Role.TUTOR);
    bookingFindUnique.mockResolvedValue({
      status: BookingStatus.PENDING,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    });
    stubTransition({
      activeBookings: 0,
      canceledAt: CANCELED_AT,
      status: BookingStatus.CANCELED,
    });

    const response = await actionRequest('reject').send({ reason: 'Double booked' }).expect(200);

    expect(response.body).toEqual({
      bookingId: BOOKING_ID,
      canceledAt: CANCELED_AT.toISOString(),
      slotStatus: 'AVAILABLE',
      status: BookingStatus.CANCELED,
    });

    const updateManyCalls = bookingUpdateMany.mock.calls as unknown as Array<
      [{ data: { canceledAt: Date; canceledById: string; cancellationReason: string } }]
    >;
    expect(updateManyCalls[0]?.[0].data).toMatchObject({
      canceledById: TUTOR_ID,
      cancellationReason: 'Double booked',
    });
    expect(updateManyCalls[0]?.[0].data.canceledAt).toBeInstanceOf(Date);
  });

  it('returns 409 when the booking is no longer pending', async () => {
    authenticateAs(Role.TUTOR);
    bookingFindUnique.mockResolvedValue({
      status: BookingStatus.CONFIRMED,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    });

    const response = await actionRequest('confirm').send({}).expect(409);

    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_PENDING', statusCode: 409 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent action won the transition', async () => {
    authenticateAs(Role.TUTOR);
    bookingFindUnique.mockResolvedValue({
      status: BookingStatus.PENDING,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    });
    stubTransition({ transitionCount: 0 });

    const response = await actionRequest('reject').send({}).expect(409);

    expect(response.body).toMatchObject({ code: 'BOOKING_TRANSITION_CONFLICT', statusCode: 409 });
    expect(bookingFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('returns 401 for the tutor inbox without an access token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/bookings/tutor').expect(401);

    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
  });

  it('returns 403 for the tutor inbox when a student asks', async () => {
    authenticateAs(Role.STUDENT);

    const response = await request(app.getHttpServer())
      .get('/api/v1/bookings/tutor')
      .set('Authorization', 'Bearer signed-token')
      .expect(403);

    expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('returns 400 for the tutor inbox with an invalid status filter', async () => {
    authenticateAs(Role.TUTOR);

    const response = await request(app.getHttpServer())
      .get('/api/v1/bookings/tutor')
      .query({ status: 'NOT_A_STATUS' })
      .set('Authorization', 'Bearer signed-token')
      .expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
  });

  describe.each(['confirm', 'reject'] as const)(
    '%s authorization and validation edges',
    (action) => {
      const field = action === 'confirm' ? 'note' : 'reason';

      it('rejects an unauthenticated request before reading or writing a booking', async () => {
        await request(app.getHttpServer())
          .post(`/api/v1/bookings/tutor/${BOOKING_ID}/${action}`)
          .send({})
          .expect(401);
        expect(bookingFindUnique).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      });

      it.each([Role.STUDENT, Role.ADMIN])('denies the authenticated role %s', async (role) => {
        authenticateAs(role);
        const response = await actionRequest(action).send({}).expect(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        expect(bookingFindUnique).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      });

      it.each([BookingStatus.PENDING, BookingStatus.CONFIRMED])(
        'checks a foreign owner before the %s state',
        async (status) => {
          authenticateAs(Role.TUTOR);
          bookingFindUnique.mockResolvedValue({
            status,
            studentUserId: STUDENT_ID,
            tutorProfileId: OTHER_TUTOR_ID,
          });
          const response = await actionRequest(action).send({}).expect(403);
          expect(response.body).toMatchObject({ code: 'BOOKING_NOT_OWNED', statusCode: 403 });
          expect(transaction).not.toHaveBeenCalled();
          expect(bookingUpdateMany).not.toHaveBeenCalled();
        },
      );

      it('returns the documented missing-record error without writing', async () => {
        authenticateAs(Role.TUTOR);
        bookingFindUnique.mockResolvedValue(null);
        const response = await actionRequest(action).send({}).expect(404);
        expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND', statusCode: 404 });
        expect(transaction).not.toHaveBeenCalled();
      });

      it('rejects a malformed UUID before querying the resource', async () => {
        authenticateAs(Role.TUTOR);
        const response = await request(app.getHttpServer())
          .post(`/api/v1/bookings/tutor/not-a-uuid/${action}`)
          .set('Authorization', 'Bearer signed-token')
          .send({})
          .expect(400);
        expect(response.body).toMatchObject({ code: 'INVALID_UUID', statusCode: 400 });
        expect(bookingFindUnique).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      });

      it.each([
        [499, 200],
        [500, 200],
        [501, 400],
      ])('handles %i ASCII characters with HTTP %i', async (length, expectedStatus) => {
        authenticateOwner();
        stubActionSuccess(action);
        const response = await actionRequest(action)
          .send({ [field]: 'x'.repeat(length) })
          .expect(expectedStatus);
        if (expectedStatus === 400) {
          expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
          expect(transaction).not.toHaveBeenCalled();
          expect(bookingUpdateMany).not.toHaveBeenCalled();
        } else {
          expect(response.body).toMatchObject({
            bookingId: BOOKING_ID,
            status: action === 'confirm' ? BookingStatus.CONFIRMED : BookingStatus.CANCELED,
            slotStatus: action === 'confirm' ? 'RESERVED' : 'AVAILABLE',
          });
        }
      });

      it.each([{}, { [field]: null }])('accepts optional text %j', async (body) => {
        authenticateOwner();
        stubActionSuccess(action);
        await actionRequest(action).send(body).expect(200);
      });

      it.each(['', ' ', '\n', 42, true, [], {}])(
        'rejects explicit invalid text %p',
        async (value) => {
          authenticateOwner();
          const response = await actionRequest(action)
            .send({ [field]: value })
            .expect(400);
          expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
          expect(transaction).not.toHaveBeenCalled();
          expect(bookingUpdateMany).not.toHaveBeenCalled();
        },
      );

      it.each([{ tutorUserId: OTHER_TUTOR_ID }, { status: 'CONFIRMED' }, { role: 'TUTOR' }])(
        'rejects spoofed authority or state %j',
        async (body) => {
          authenticateOwner();
          await actionRequest(action).send(body).expect(400);
          expect(transaction).not.toHaveBeenCalled();
        },
      );
    },
  );

  describe('tutor inbox HTTP query validation', () => {
    beforeEach(() => {
      authenticateAs(Role.TUTOR);
      bookingFindMany.mockResolvedValue([]);
      bookingCount.mockResolvedValue(0);
    });

    it.each([
      [{ page: 0 }, 400],
      [{ page: 1 }, 200],
      [{ page: 2 }, 200],
      [{ pageSize: 0 }, 400],
      [{ pageSize: 1 }, 200],
      [{ pageSize: 2 }, 200],
      [{ pageSize: 99 }, 200],
      [{ pageSize: 100 }, 200],
      [{ pageSize: 101 }, 400],
      [{ page: 1.5 }, 400],
      [{ pageSize: 'NaN' }, 400],
      [{ from: 'not-an-iso-date' }, 400],
      [{ to: 'not-an-iso-date' }, 400],
    ])('validates %j with HTTP %i', async (query, expectedStatus) => {
      await inboxRequest().query(query).expect(expectedStatus);
      if (expectedStatus === 400) {
        expect(bookingFindMany).not.toHaveBeenCalled();
      }
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each(Object.values(BookingStatus))('accepts the actual status %s', async (status) => {
      const response = await inboxRequest().query({ status }).expect(200);
      expect(response.body).toEqual({ items: [], total: 0 });
      expect(transaction).not.toHaveBeenCalled();
    });

    it.each([42, ['PENDING', 'CONFIRMED']])(
      'rejects incorrectly typed status %p',
      async (status) => {
        await inboxRequest().query({ status }).expect(400);
        expect(bookingFindMany).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe.each(['confirm', 'reject'] as const)('%s HTTP state and recheck edges', (action) => {
    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.COMPLETED,
      BookingStatus.CANCELED,
      BookingStatus.EXPIRED,
    ])('returns 409 for the existing %s state without a write', async (status) => {
      authenticateOwner();
      bookingFindUnique.mockResolvedValue({
        status,
        studentUserId: STUDENT_ID,
        tutorProfileId: TUTOR_ID,
      });
      const response = await actionRequest(action).send({}).expect(409);
      expect(response.body).toMatchObject({ code: 'BOOKING_NOT_PENDING', statusCode: 409 });
      expect(transaction).not.toHaveBeenCalled();
      expect(bookingUpdateMany).not.toHaveBeenCalled();
    });

    it.each(['missing', 'foreign'] as const)(
      'rechecks a %s record after the guard passed',
      async (outcome) => {
        authenticateOwner();
        bookingFindUnique.mockResolvedValueOnce({
          studentUserId: STUDENT_ID,
          tutorProfileId: TUTOR_ID,
        });
        bookingFindUnique.mockResolvedValueOnce(
          outcome === 'missing'
            ? null
            : { status: BookingStatus.PENDING, tutorProfileId: OTHER_TUTOR_ID },
        );
        const response = await actionRequest(action)
          .send({})
          .expect(outcome === 'missing' ? 404 : 403);
        expect(response.body).toMatchObject({
          code: outcome === 'missing' ? 'BOOKING_NOT_FOUND' : 'BOOKING_NOT_OWNED',
        });
        expect(transaction).not.toHaveBeenCalled();
      },
    );

    it.each([0, 2])(
      'returns conflict for %i affected rows without reading a success result',
      async (transitionCount) => {
        authenticateOwner();
        stubTransition({ transitionCount });
        const response = await actionRequest(action).send({}).expect(409);
        expect(response.body).toMatchObject({
          code: 'BOOKING_TRANSITION_CONFLICT',
          statusCode: 409,
        });
        expect(bookingFindUniqueOrThrow).not.toHaveBeenCalled();
        expect(bookingCount).not.toHaveBeenCalled();
      },
    );
  });

  it.each([-1, 0, 1])('validates inbox from minus to at %i milliseconds', async (deltaMs) => {
    authenticateAs(Role.TUTOR);
    bookingFindMany.mockResolvedValue([]);
    bookingCount.mockResolvedValue(0);
    const to = '2026-10-10T03:00:00.000Z';
    const from = new Date(new Date(to).getTime() + deltaMs).toISOString();
    await inboxRequest()
      .query({ from, to })
      .expect(deltaMs > 0 ? 400 : 200);
    if (deltaMs > 0) {
      expect(bookingFindMany).not.toHaveBeenCalled();
      expect(bookingCount).not.toHaveBeenCalled();
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  function inboxRequest(): request.Test {
    return request(app.getHttpServer())
      .get('/api/v1/bookings/tutor')
      .set('Authorization', 'Bearer signed-token');
  }

  function authenticateOwner(): void {
    authenticateAs(Role.TUTOR);
    bookingFindUnique.mockResolvedValue({
      status: BookingStatus.PENDING,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    });
  }

  function stubActionSuccess(action: 'confirm' | 'reject'): void {
    stubTransition({
      activeBookings: action === 'confirm' ? 1 : 0,
      canceledAt: action === 'confirm' ? null : CANCELED_AT,
      status: action === 'confirm' ? BookingStatus.CONFIRMED : BookingStatus.CANCELED,
    });
  }

  function actionRequest(action: 'confirm' | 'reject'): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/tutor/${BOOKING_ID}/${action}`)
      .set('Authorization', 'Bearer signed-token');
  }

  function stubTransition(options: {
    activeBookings?: number;
    canceledAt?: Date | null;
    status?: BookingStatus;
    transitionCount?: number;
  }): void {
    bookingUpdateMany.mockResolvedValue({ count: options.transitionCount ?? 1 });
    bookingFindUniqueOrThrow.mockResolvedValue({
      canceledAt: options.canceledAt ?? null,
      id: BOOKING_ID,
      slotId: SLOT_ID,
      status: options.status ?? BookingStatus.CONFIRMED,
    });
    bookingCount.mockResolvedValue(options.activeBookings ?? 1);
    transaction.mockImplementation(
      async (callback: (tx: { booking: Record<string, jest.Mock> }) => Promise<unknown>) =>
        callback({
          booking: {
            count: bookingCount,
            findUniqueOrThrow: bookingFindUniqueOrThrow,
            updateMany: bookingUpdateMany,
          },
        }),
    );
  }

  function authenticateAs(role: Role): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: TUTOR_ID });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: 'tutor@example.com',
        emailVerifiedAt: new Date(),
        id: TUTOR_ID,
        role,
      },
      userId: TUTOR_ID,
    });
  }
});

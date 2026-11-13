import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Prisma, Role } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingCouponsService } from '@modules/bookings/booking-coupons.service';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_STUDENT_ID = '30000000-0000-4000-8000-000000000002';
const BOOKING_ID = '40000000-0000-4000-8000-000000000001';
const COUPON_ID = '50000000-0000-4000-8000-000000000001';

const BASE_URL = `/api/v1/bookings/me/${BOOKING_ID}`;

describe('Booking coupons HTTP contract (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const bookingFindUnique = jest.fn();
  const bookingFindFirst = jest.fn();
  const bookingUpdate = jest.fn();
  const couponFindUnique = jest.fn();
  const couponUseFindUnique = jest.fn();
  const couponUseCount = jest.fn();
  const couponReservationFindFirst = jest.fn();
  const couponReservationCount = jest.fn();
  const paymentAttemptFindFirst = jest.fn();
  const queryRaw = jest.fn();
  const transactionMock = jest.fn();

  const tx = {
    $queryRaw: queryRaw,
    booking: {
      findFirst: bookingFindFirst,
      findUnique: bookingFindUnique,
      update: bookingUpdate,
    },
    coupon: {
      findUnique: couponFindUnique,
    },
    couponReservation: {
      count: couponReservationCount,
      findFirst: couponReservationFindFirst,
    },
    couponUse: {
      count: couponUseCount,
      findUnique: couponUseFindUnique,
    },
    paymentAttempt: {
      findFirst: paymentAttemptFindFirst,
    },
  };

  const prismaMock = {
    ...tx,
    $transaction: transactionMock,
    authSession: { findUnique: authSessionFindUnique },
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        BookingsService,
        BookingCouponsService,
        JwtAuthGuard,
        ResourceOwnershipGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        { provide: NotificationEventsService, useValue: { write: jest.fn() } },
        { provide: PrismaService, useValue: prismaMock },
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
    jest.resetAllMocks();
    transactionMock.mockImplementation(async (cb: (client: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );
    queryRaw.mockResolvedValue([]);
    authenticate(Role.STUDENT);
  });

  function authenticate(
    role: Role = Role.STUDENT,
    userId = STUDENT_ID,
    consentOverrides: Partial<{
      consentAcceptedAt: Date | null;
      policyVersion: string | null;
    }> = {},
  ): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: userId });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        consentAcceptedAt: new Date(),
        deletedAt: null,
        email: 'student@example.com',
        emailVerifiedAt: new Date(),
        id: userId,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        role,
        ...consentOverrides,
      },
      userId,
    });
  }

  function mockBooking(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      appliedCouponCode: null,
      appliedCouponId: null,
      appliedCouponPercent: null,
      currency: 'THB',
      discountAmount: new Prisma.Decimal(0),
      id: BOOKING_ID,
      netAmount: new Prisma.Decimal(450),
      paymentPending: false,
      paymentStatus: PaymentStatus.UNPAID,
      slot: { startAtUtc: new Date(Date.now() + 24 * 3_600_000) },
      status: BookingStatus.CONFIRMED,
      studentUserId: STUDENT_ID,
      subtotalAmount: new Prisma.Decimal(450),
      tutorProfileId: '20000000-0000-4000-8000-000000000001',
      ...overrides,
    };
  }

  function mockCoupon(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      _count: {
        reservations: 0,
        uses: 0,
      },
      active: true,
      code: 'WELCOME10',
      expiresAt: new Date(Date.now() + 86400000),
      id: COUPON_ID,
      maxUses: 100,
      percent: 10,
      ...overrides,
    };
  }

  describe('POST /api/v1/bookings/me/:bookingId/coupon-quote', () => {
    it('returns 200 with calculated coupon preview and Cache-Control: no-store', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon());
      couponUseFindUnique.mockResolvedValue(null);
      couponUseCount.mockResolvedValue(5);
      couponReservationCount.mockResolvedValue(1);

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'welcome10' })
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        bookingId: BOOKING_ID,
        coupon: {
          code: 'WELCOME10',
          id: COUPON_ID,
          percent: 10,
        },
        currency: 'THB',
        discountAmount: '45.00',
        netAmount: '405.00',
        quotedAt: expect.any(String) as unknown,
        subtotalAmount: '450.00',
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    it('rejects an invalid bookingId with 400 INVALID_UUID', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/bookings/me/not-a-uuid/coupon-quote')
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'INVALID_UUID',
        statusCode: 400,
      });
    });

    it('rejects an unknown request body field with 400 VALIDATION_FAILED', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10', discountAmount: '45.00' })
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        statusCode: 400,
      });
    });

    it('rejects unauthorized access with 401 UNAUTHENTICATED', async () => {
      await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .send({ code: 'WELCOME10' })
        .expect(401);
    });

    it('rejects access from a foreign student with 403 BOOKING_NOT_OWNED', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking({ studentUserId: OTHER_STUDENT_ID }));

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(403);

      expect(response.body).toMatchObject({
        code: 'BOOKING_NOT_OWNED',
        statusCode: 403,
      });
    });

    it('returns 404 BOOKING_NOT_FOUND when the booking does not exist', async () => {
      bookingFindUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(404);

      expect(response.body).toMatchObject({
        code: 'BOOKING_NOT_FOUND',
        statusCode: 404,
      });
    });

    it('returns 404 COUPON_NOT_FOUND when coupon code is unknown', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'UNKNOWN_CODE' })
        .expect(404);

      expect(response.body).toMatchObject({
        code: 'COUPON_NOT_FOUND',
        statusCode: 404,
      });
    });

    it('returns 409 COUPON_EXPIRED when coupon expired', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon({ expiresAt: new Date(Date.now() - 5000) }));

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'COUPON_EXPIRED',
        statusCode: 409,
      });
    });

    it('returns 409 PAYMENT_AMOUNT_UNSUPPORTED when net amount is unsupported (0 < net < 20)', async () => {
      // 100 THB subtotal with 85% discount = 15 THB net
      bookingFindUnique.mockResolvedValue(mockBooking({ subtotalAmount: new Prisma.Decimal(100) }));
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon({ percent: 85 }));
      couponUseFindUnique.mockResolvedValue(null);
      couponUseCount.mockResolvedValue(0);
      couponReservationCount.mockResolvedValue(0);

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'PAYMENT_AMOUNT_UNSUPPORTED',
        statusCode: 409,
      });
    });

    it('rejects quote request with 403 when privacy consent was never accepted', async () => {
      authenticate(Role.STUDENT, STUDENT_ID, { consentAcceptedAt: null });

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects quote request with 403 when privacy policyVersion is outdated', async () => {
      authenticate(Role.STUDENT, STUDENT_ID, { policyVersion: '2025-01-01' });

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
      });
    });

    it('returns 409 PAYMENT_AMOUNT_UNSUPPORTED when rounding produces net 0.00 for non-100% coupon', async () => {
      // 0.50 subtotal with 99% discount rounds HALF_UP to 0.50 discount -> net 0.00, which is invalid without 100% coupon
      bookingFindUnique.mockResolvedValue(
        mockBooking({ subtotalAmount: new Prisma.Decimal('0.50') }),
      );
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon({ percent: 99 }));
      couponUseFindUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME99' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'PAYMENT_AMOUNT_UNSUPPORTED',
        statusCode: 409,
      });
    });

    it('returns 200 with net 0.00 for valid 100% coupon', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon({ code: 'FREE100', percent: 100 }));
      couponUseFindUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'FREE100' })
        .expect(200);

      expect(response.body).toMatchObject({
        discountAmount: '450.00',
        netAmount: '0.00',
      });
    });

    it('returns 409 COUPON_EXHAUSTED when coupon maxUses is reached in single _count read', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(
        mockCoupon({ maxUses: 10, _count: { reservations: 2, uses: 8 } }),
      );
      couponUseFindUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .post(`${BASE_URL}/coupon-quote`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'COUPON_EXHAUSTED',
        statusCode: 409,
      });
    });
  });

  describe('PUT /api/v1/bookings/me/:bookingId/coupon', () => {
    it('applies a coupon and returns the updated snapshot with Cache-Control: no-store', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon());
      couponUseFindUnique.mockResolvedValue(null);
      couponUseCount.mockResolvedValue(1);
      couponReservationCount.mockResolvedValue(0);
      bookingUpdate.mockResolvedValue(
        mockBooking({
          appliedCouponCode: 'WELCOME10',
          appliedCouponId: COUPON_ID,
          appliedCouponPercent: 10,
          discountAmount: new Prisma.Decimal(45),
          netAmount: new Prisma.Decimal(405),
        }),
      );

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        bookingId: BOOKING_ID,
        coupon: {
          code: 'WELCOME10',
          id: COUPON_ID,
          percent: 10,
        },
        currency: 'THB',
        discountAmount: '45.00',
        netAmount: '405.00',
        paymentPending: false,
        paymentStatus: PaymentStatus.UNPAID,
        subtotalAmount: '450.00',
      });
    });

    it('returns 200 without writing when applying the same valid code again (idempotent)', async () => {
      bookingFindUnique.mockResolvedValue(
        mockBooking({
          appliedCouponCode: 'WELCOME10',
          appliedCouponId: COUPON_ID,
          appliedCouponPercent: 10,
          discountAmount: new Prisma.Decimal(45),
          netAmount: new Prisma.Decimal(405),
        }),
      );
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon());
      couponUseFindUnique.mockResolvedValue(null);
      couponUseCount.mockResolvedValue(1);
      couponReservationCount.mockResolvedValue(0);

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(200);

      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(response.body).toMatchObject({ discountAmount: '45.00' });
    });

    it('returns 409 PAYMENT_IN_PROGRESS when paymentPending is true', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking({ paymentPending: true }));

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'PAYMENT_IN_PROGRESS',
        statusCode: 409,
      });
    });

    it('returns 409 BOOKING_NOT_PAYABLE when booking is already paid', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking({ paymentStatus: PaymentStatus.PAID }));

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'BOOKING_NOT_PAYABLE',
        statusCode: 409,
      });
    });

    it('rejects apply request with 403 when privacy consent was never accepted', async () => {
      authenticate(Role.STUDENT, STUDENT_ID, { consentAcceptedAt: null });

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects apply request with 403 when privacy policyVersion is outdated', async () => {
      authenticate(Role.STUDENT, STUDENT_ID, { policyVersion: '2025-01-01' });

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME10' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
      });
    });

    it('returns 409 PAYMENT_AMOUNT_UNSUPPORTED when rounding produces net 0.00 for non-100% coupon before write', async () => {
      bookingFindUnique.mockResolvedValue(
        mockBooking({ subtotalAmount: new Prisma.Decimal('0.50') }),
      );
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon({ percent: 99 }));
      couponUseFindUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'WELCOME99' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'PAYMENT_AMOUNT_UNSUPPORTED',
        statusCode: 409,
      });
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    it('applies a 100% coupon successfully yielding net 0.00', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      couponFindUnique.mockResolvedValue(mockCoupon({ code: 'FREE100', percent: 100 }));
      couponUseFindUnique.mockResolvedValue(null);
      bookingUpdate.mockResolvedValue(
        mockBooking({
          appliedCouponCode: 'FREE100',
          appliedCouponId: COUPON_ID,
          appliedCouponPercent: 100,
          discountAmount: new Prisma.Decimal(450),
          netAmount: new Prisma.Decimal(0),
        }),
      );

      const response = await request(app.getHttpServer())
        .put(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ code: 'FREE100' })
        .expect(200);

      expect(response.body).toMatchObject({
        discountAmount: '450.00',
        netAmount: '0.00',
      });
    });
  });

  describe('DELETE /api/v1/bookings/me/:bookingId/coupon', () => {
    it('removes the applied coupon, restores subtotalAmount, and sets Cache-Control: no-store', async () => {
      bookingFindUnique.mockResolvedValue(
        mockBooking({
          appliedCouponCode: 'WELCOME10',
          appliedCouponId: COUPON_ID,
          appliedCouponPercent: 10,
          discountAmount: new Prisma.Decimal(45),
          netAmount: new Prisma.Decimal(405),
        }),
      );
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);
      bookingUpdate.mockResolvedValue(mockBooking());

      const response = await request(app.getHttpServer())
        .delete(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual({
        bookingId: BOOKING_ID,
        coupon: null,
        currency: 'THB',
        discountAmount: '0.00',
        netAmount: '450.00',
        paymentPending: false,
        paymentStatus: PaymentStatus.UNPAID,
        subtotalAmount: '450.00',
      });
    });

    it('returns 200 without writing when coupon is already removed (idempotent)', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      paymentAttemptFindFirst.mockResolvedValue(null);
      couponReservationFindFirst.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .delete(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .expect(200);

      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(response.body).toMatchObject({
        coupon: null,
        netAmount: '450.00',
      });
    });

    it('rejects non-empty body with 400 VALIDATION_FAILED', async () => {
      bookingFindUnique.mockResolvedValue(mockBooking());
      const response = await request(app.getHttpServer())
        .delete(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .send({ extra: 'field' })
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        statusCode: 400,
      });
    });

    it('rejects remove request with 403 when privacy consent was never accepted', async () => {
      authenticate(Role.STUDENT, STUDENT_ID, { consentAcceptedAt: null });

      const response = await request(app.getHttpServer())
        .delete(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects remove request with 403 when privacy policyVersion is outdated', async () => {
      authenticate(Role.STUDENT, STUDENT_ID, { policyVersion: '2025-01-01' });

      const response = await request(app.getHttpServer())
        .delete(`${BASE_URL}/coupon`)
        .set('Authorization', 'Bearer signed-token')
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
      });
    });
  });

  describe('GET /api/v1/bookings/me/:bookingId (coupon snapshot read)', () => {
    it('returns 200 with coupon snapshot and Cache-Control: no-store', async () => {
      bookingFindUnique.mockResolvedValue({
        studentUserId: STUDENT_ID,
        tutorProfileId: '20000000-0000-4000-8000-000000000001',
      });
      bookingFindFirst.mockResolvedValue({
        createdAt: new Date('2026-09-10T09:04:31.001Z'),
        currency: 'THB',
        discountAmount: new Prisma.Decimal(45),
        appliedCouponCode: 'WELCOME10',
        appliedCouponId: COUPON_ID,
        appliedCouponPercent: 10,
        id: BOOKING_ID,
        listing: {
          description: 'One-on-one algebra tutoring.',
          gradeLevel: { id: 'grade-id', name: 'Grade 10' },
          id: 'listing-id',
          pricePerHour: new Prisma.Decimal(450),
          subject: { id: 'subject-id', name: 'Mathematics' },
        },
        mockReference: null,
        netAmount: new Prisma.Decimal(405),
        paidAt: null,
        paymentPending: false,
        paymentReference: null,
        paymentStatus: PaymentStatus.UNPAID,
        slot: {
          endAtUtc: new Date('2026-09-15T11:04:06.784Z'),
          id: 'slot-id',
          startAtUtc: new Date('2026-09-15T10:04:06.784Z'),
        },
        status: BookingStatus.CONFIRMED,
        subtotalAmount: new Prisma.Decimal(450),
        tutorProfile: { displayName: 'Anan Suksawat', userId: 'tutor-id' },
        updatedAt: new Date('2026-09-10T09:04:31.001Z'),
      });

      const response = await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', 'Bearer signed-token')
        .expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        coupon: {
          code: 'WELCOME10',
          id: COUPON_ID,
          percent: 10,
        },
        discountAmount: '45.00',
        id: BOOKING_ID,
        netAmount: '405.00',
        subtotalAmount: '450.00',
      });
    });

    it('returns coupon: null on legacy rows without coupon snapshot', async () => {
      bookingFindUnique.mockResolvedValue({
        studentUserId: STUDENT_ID,
        tutorProfileId: '20000000-0000-4000-8000-000000000001',
      });
      bookingFindFirst.mockResolvedValue({
        createdAt: new Date('2026-09-10T09:04:31.001Z'),
        currency: 'THB',
        discountAmount: new Prisma.Decimal(0),
        appliedCouponCode: null,
        appliedCouponId: null,
        appliedCouponPercent: null,
        id: BOOKING_ID,
        listing: {
          description: 'One-on-one algebra tutoring.',
          gradeLevel: { id: 'grade-id', name: 'Grade 10' },
          id: 'listing-id',
          pricePerHour: new Prisma.Decimal(450),
          subject: { id: 'subject-id', name: 'Mathematics' },
        },
        mockReference: null,
        netAmount: new Prisma.Decimal(450),
        paidAt: null,
        paymentPending: false,
        paymentReference: null,
        paymentStatus: PaymentStatus.UNPAID,
        slot: {
          endAtUtc: new Date('2026-09-15T11:04:06.784Z'),
          id: 'slot-id',
          startAtUtc: new Date('2026-09-15T10:04:06.784Z'),
        },
        status: BookingStatus.CONFIRMED,
        subtotalAmount: new Prisma.Decimal(450),
        tutorProfile: { displayName: 'Anan Suksawat', userId: 'tutor-id' },
        updatedAt: new Date('2026-09-10T09:04:31.001Z'),
      });

      const response = await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', 'Bearer signed-token')
        .expect(200);

      expect(response.body).toMatchObject({
        coupon: null,
        discountAmount: '0.00',
        netAmount: '450.00',
      });
    });

    it('returns 403 BOOKING_NOT_OWNED when foreign student requests booking', async () => {
      bookingFindUnique.mockResolvedValue({
        studentUserId: OTHER_STUDENT_ID,
        tutorProfileId: '20000000-0000-4000-8000-000000000001',
      });

      const response = await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', 'Bearer signed-token')
        .expect(403);

      expect(response.body).toMatchObject({
        code: 'BOOKING_NOT_OWNED',
        statusCode: 403,
      });
    });

    it('returns 404 BOOKING_NOT_FOUND when booking does not exist', async () => {
      bookingFindUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get(BASE_URL)
        .set('Authorization', 'Bearer signed-token')
        .expect(404);

      expect(response.body).toMatchObject({
        code: 'BOOKING_NOT_FOUND',
        statusCode: 404,
      });
    });
  });
});

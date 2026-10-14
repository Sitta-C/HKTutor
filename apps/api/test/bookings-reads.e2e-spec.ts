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
const TUTOR_PROFILE_ID = '20000000-0000-4000-8000-000000000001';
const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const PAID_AT = new Date('2026-10-09T09:04:31.001Z');
const REFERENCE = 'DEMO-7F3A91';

/**
 * S2-T05 renders the paid/unpaid state from these two reads, so the payment columns have to survive
 * the whole pipeline rather than only the service mapping. The real controller and service run here;
 * only Prisma is stubbed.
 */
describe('Student booking reads expose the payment state (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const bookingCount = jest.fn();
  const bookingFindFirst = jest.fn();
  const bookingFindMany = jest.fn();
  const bookingFindUnique = jest.fn();

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
            authSession: { findUnique: authSessionFindUnique },
            booking: {
              count: bookingCount,
              findFirst: bookingFindFirst,
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

  it('returns the recorded payment on the list', async () => {
    authenticateAsStudent();
    bookingFindMany.mockResolvedValue([paidRow()]);
    bookingCount.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .get('/api/v1/bookings/me')
      .set('Authorization', 'Bearer signed-token')
      .expect(200);

    const body = response.body as { items: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      mockReference: REFERENCE,
      netAmount: '450.00',
      paidAt: PAID_AT.toISOString(),
      paymentStatus: PaymentStatus.PAID,
    });
  });

  // S2-T05 branches on these being present and null rather than absent, so the unpaid case is
  // asserted on the serialized body instead of the service return value.
  it('keeps the payment fields present and null while the booking is unpaid', async () => {
    authenticateAsStudent();
    bookingFindMany.mockResolvedValue([
      { ...paidRow(), mockReference: null, paidAt: null, paymentStatus: PaymentStatus.UNPAID },
    ]);
    bookingCount.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .get('/api/v1/bookings/me')
      .set('Authorization', 'Bearer signed-token')
      .expect(200);

    const item = (response.body as { items: Array<Record<string, unknown>> }).items[0] ?? {};
    expect(item).toMatchObject({ paymentStatus: PaymentStatus.UNPAID });
    expect(item.paidAt).toBeNull();
    expect(item.mockReference).toBeNull();
    expect(Object.keys(item)).toEqual(
      expect.arrayContaining(['mockReference', 'paidAt', 'paymentStatus']),
    );
  });

  it('returns the recorded payment on the detail read', async () => {
    authenticateAsStudent();
    bookingFindUnique.mockResolvedValue({
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_PROFILE_ID,
    });
    bookingFindFirst.mockResolvedValue({
      ...paidRow(),
      updatedAt: new Date('2026-10-09T09:05:00.000Z'),
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/bookings/me/${BOOKING_ID}`)
      .set('Authorization', 'Bearer signed-token')
      .expect(200);

    expect(response.body).toMatchObject({
      id: BOOKING_ID,
      mockReference: REFERENCE,
      paidAt: PAID_AT.toISOString(),
      paymentStatus: PaymentStatus.PAID,
    });
  });

  function paidRow() {
    return {
      createdAt: new Date('2026-09-10T09:04:31.001Z'),
      currency: 'THB',
      discountAmount: new Prisma.Decimal(0),
      id: BOOKING_ID,
      listing: {
        description: 'One-on-one algebra and calculus tutoring.',
        gradeLevel: { id: 'grade-id', name: 'Grade 10' },
        id: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
        pricePerHour: new Prisma.Decimal(450),
        subject: { id: 'subject-id', name: 'Mathematics' },
      },
      mockReference: REFERENCE,
      netAmount: new Prisma.Decimal(450),
      paidAt: PAID_AT,
      paymentStatus: PaymentStatus.PAID,
      slot: {
        endAtUtc: new Date('2026-09-15T11:04:06.784Z'),
        id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
        startAtUtc: new Date('2026-09-15T10:04:06.784Z'),
      },
      status: BookingStatus.CONFIRMED,
      subtotalAmount: new Prisma.Decimal(450),
      tutorProfile: { displayName: 'Anan Suksawat', userId: TUTOR_PROFILE_ID },
    };
  }

  function authenticateAsStudent(): void {
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
        role: Role.STUDENT,
      },
      userId: STUDENT_ID,
    });
  }
});

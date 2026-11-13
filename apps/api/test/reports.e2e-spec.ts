import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Prisma, Role } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { ReportsController } from '@modules/reports/reports.controller';
import { ReportsService } from '@modules/reports/reports.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const ROUTE = '/api/v1/reports/tutor/me';
const TUTOR_A = '20000000-0000-4000-8000-000000000001';
const TUTOR_B = '20000000-0000-4000-8000-000000000002';
const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const VERIFIED_AT = new Date('2026-10-01T00:00:00.000Z');
const CONSENT_AT = new Date('2026-10-01T00:00:00.000Z');

describe('Tutor Reports HTTP contract (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const bookingGroupBy = jest.fn();

  function authenticate(
    role: Role,
    userId = TUTOR_A,
    overrides: Partial<{
      accountStatus: AccountStatus;
      consentAcceptedAt: Date | null;
      deletedAt: Date | null;
      emailVerifiedAt: Date | null;
      expiresAt: Date;
      policyVersion: string | null;
      revokedAt: Date | null;
    }> = {},
  ): void {
    verifyAccessToken.mockImplementation((token: string) => ({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sid: `session-${token}`,
      sub: userId,
    }));
    authSessionFindUnique.mockResolvedValue({
      expiresAt: overrides.expiresAt ?? new Date('2099-01-01T00:00:00.000Z'),
      revokedAt: overrides.revokedAt ?? null,
      userId,
      user: {
        accountStatus: overrides.accountStatus ?? AccountStatus.ACTIVE,
        consentAcceptedAt:
          overrides.consentAcceptedAt === undefined ? CONSENT_AT : overrides.consentAcceptedAt,
        deletedAt: overrides.deletedAt ?? null,
        email: 'synthetic@example.invalid',
        emailVerifiedAt:
          overrides.emailVerifiedAt === undefined ? VERIFIED_AT : overrides.emailVerifiedAt,
        id: userId,
        policyVersion:
          overrides.policyVersion === undefined
            ? CURRENT_PRIVACY_POLICY_VERSION
            : overrides.policyVersion,
        role,
      },
    });
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        ReportsService,
        JwtAuthGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: {
            authSession: { findUnique: authSessionFindUnique },
            booking: {
              groupBy: bookingGroupBy,
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

  beforeEach(() => {
    jest.resetAllMocks();
    authenticate(Role.TUTOR);
    bookingGroupBy.mockResolvedValue([]);
  });

  it('returns 401 UNAUTHENTICATED when Authorization header is missing', async () => {
    const response = await request(app.getHttpServer()).get(ROUTE).expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });
    expect(bookingGroupBy).not.toHaveBeenCalled();
  });

  it('returns 401 UNAUTHENTICATED when token verification fails', async () => {
    verifyAccessToken.mockReturnValue(null);

    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('invalid-token', { type: 'bearer' })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });
    expect(bookingGroupBy).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked session', { revokedAt: new Date('2026-10-02T00:00:00.000Z') }],
    ['expired session', { expiresAt: new Date('2020-01-01T00:00:00.000Z') }],
    ['suspended account', { accountStatus: AccountStatus.SUSPENDED }],
    ['deleted account', { deletedAt: new Date('2026-10-02T00:00:00.000Z') }],
    ['unverified email', { emailVerifiedAt: null }],
  ])('returns 401 UNAUTHENTICATED for %s', async (_label, overrides) => {
    authenticate(Role.TUTOR, TUTOR_A, overrides);

    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('valid-token', { type: 'bearer' })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });
    expect(bookingGroupBy).not.toHaveBeenCalled();
  });

  it.each([
    ['missing consent', { consentAcceptedAt: null }],
    ['outdated policy version', { policyVersion: '2025-01-01' }],
  ])('returns 403 FORBIDDEN for %s before running any report query', async (_label, overrides) => {
    authenticate(Role.TUTOR, TUTOR_A, overrides);

    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('valid-token', { type: 'bearer' })
      .expect(403);

    expect(response.body).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Accept the current privacy notice to continue.',
      statusCode: 403,
    });
    expect(bookingGroupBy).not.toHaveBeenCalled();
  });

  it.each([
    [Role.STUDENT, STUDENT_ID],
    [Role.ADMIN, ADMIN_ID],
  ])('returns 403 FORBIDDEN for non-tutor role %s', async (role, userId) => {
    authenticate(role, userId);

    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('valid-token', { type: 'bearer' })
      .expect(403);

    expect(response.body).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(bookingGroupBy).not.toHaveBeenCalled();
  });

  it.each([
    `tutorId=${TUTOR_B}`,
    'userId=someone',
    'from=2026-01-01T00:00:00.000Z',
    'to=2026-12-31T00:00:00.000Z',
    'status=COMPLETED',
    'extra=',
  ])('returns 400 VALIDATION_FAILED for unknown query parameter (%s)', async (query) => {
    const response = await request(app.getHttpServer())
      .get(`${ROUTE}?${query}`)
      .auth('valid-token', { type: 'bearer' })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
    expect(bookingGroupBy).not.toHaveBeenCalled();
  });

  it.each([
    ['object with tutorId', { tutorId: TUTOR_B }],
    ['object with date filter', { from: '2026-01-01T00:00:00.000Z' }],
    ['non-object array body', ['unexpected']],
  ])('returns 400 VALIDATION_FAILED for non-empty body (%s)', async (_label, payload) => {
    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('valid-token', { type: 'bearer' })
      .send(payload)
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      statusCode: 400,
    });
    expect(bookingGroupBy).not.toHaveBeenCalled();
  });

  it('returns 200 with Cache-Control: no-store and the 12-booking 905.00 THB / 75% report', async () => {
    bookingGroupBy.mockResolvedValue([
      {
        status: BookingStatus.PENDING,
        paymentStatus: PaymentStatus.UNPAID,
        _count: { _all: 3 },
        _sum: { netAmount: new Prisma.Decimal('1350.00') },
      },
      {
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.UNPAID,
        _count: { _all: 1 },
        _sum: { netAmount: new Prisma.Decimal('450.00') },
      },
      {
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        _count: { _all: 2 },
        _sum: { netAmount: new Prisma.Decimal('905.00') },
      },
      {
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.UNPAID,
        _count: { _all: 4 },
        _sum: { netAmount: new Prisma.Decimal('1800.00') },
      },
      {
        status: BookingStatus.CANCELED,
        paymentStatus: PaymentStatus.UNPAID,
        _count: { _all: 2 },
        _sum: { netAmount: new Prisma.Decimal('900.00') },
      },
    ]);

    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('valid-token', { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({
      totalBookings: 12,
      statusCounts: {
        PENDING: 3,
        CONFIRMED: 1,
        COMPLETED: 6,
        CANCELED: 2,
        EXPIRED: 0,
      },
      revenue: {
        amount: '905.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 6,
        finalized: 8,
        percent: 75,
      },
    });
    expect(bookingGroupBy).toHaveBeenCalledWith({
      by: ['status', 'paymentStatus'],
      where: { tutorProfileId: TUTOR_A },
      _count: { _all: true },
      _sum: { netAmount: true },
    });
  });

  it('returns 200 with zero counts, "0.00", and null percent for an empty ledger', async () => {
    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('valid-token', { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({
      totalBookings: 0,
      statusCounts: {
        PENDING: 0,
        CONFIRMED: 0,
        COMPLETED: 0,
        CANCELED: 0,
        EXPIRED: 0,
      },
      revenue: {
        amount: '0.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 0,
        finalized: 0,
        percent: null,
      },
    });
  });

  it('returns 200 with null percent for expired-only bookings', async () => {
    bookingGroupBy.mockResolvedValue([
      {
        status: BookingStatus.EXPIRED,
        paymentStatus: PaymentStatus.UNPAID,
        _count: { _all: 3 },
        _sum: { netAmount: new Prisma.Decimal('1350.00') },
      },
    ]);

    const response = await request(app.getHttpServer())
      .get(ROUTE)
      .auth('valid-token', { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(response.body).toEqual({
      totalBookings: 3,
      statusCounts: {
        PENDING: 0,
        CONFIRMED: 0,
        COMPLETED: 0,
        CANCELED: 0,
        EXPIRED: 3,
      },
      revenue: {
        amount: '0.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 0,
        finalized: 0,
        percent: null,
      },
    });
  });

  it('isolates concurrent report requests per authenticated tutor without cross-request query leakage', async () => {
    const groupsByTutor = new Map<
      string,
      Array<{
        status: BookingStatus;
        paymentStatus: PaymentStatus;
        _count: { _all: number };
        _sum: { netAmount: Prisma.Decimal | null };
      }>
    >([
      [
        TUTOR_A,
        [
          {
            status: BookingStatus.COMPLETED,
            paymentStatus: PaymentStatus.PAID,
            _count: { _all: 2 },
            _sum: { netAmount: new Prisma.Decimal('905.00') },
          },
          {
            status: BookingStatus.CANCELED,
            paymentStatus: PaymentStatus.UNPAID,
            _count: { _all: 1 },
            _sum: { netAmount: new Prisma.Decimal('450.00') },
          },
        ],
      ],
      [
        TUTOR_B,
        [
          {
            status: BookingStatus.EXPIRED,
            paymentStatus: PaymentStatus.UNPAID,
            _count: { _all: 4 },
            _sum: { netAmount: new Prisma.Decimal('1800.00') },
          },
        ],
      ],
    ]);

    verifyAccessToken.mockImplementation((token: string) => ({
      exp: Math.floor(Date.now() / 1000) + 3600,
      sid: `session-${token}`,
      sub: token === 'token-a' ? TUTOR_A : TUTOR_B,
    }));
    authSessionFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      const userId = where.id === 'session-token-a' ? TUTOR_A : TUTOR_B;
      return Promise.resolve({
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        revokedAt: null,
        userId,
        user: {
          accountStatus: AccountStatus.ACTIVE,
          consentAcceptedAt: CONSENT_AT,
          deletedAt: null,
          email: `${userId}@example.invalid`,
          emailVerifiedAt: VERIFIED_AT,
          id: userId,
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
          role: Role.TUTOR,
        },
      });
    });

    bookingGroupBy.mockImplementation(async ({ where }: { where: { tutorProfileId: string } }) => {
      // Yield to overlap the two concurrent HTTP requests against the mocked Prisma boundary.
      await new Promise((resolve) =>
        setTimeout(resolve, where.tutorProfileId === TUTOR_A ? 15 : 5),
      );
      return groupsByTutor.get(where.tutorProfileId) ?? [];
    });

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer()).get(ROUTE).auth('token-a', { type: 'bearer' }).expect(200),
      request(app.getHttpServer()).get(ROUTE).auth('token-b', { type: 'bearer' }).expect(200),
    ]);

    expect(bookingGroupBy).toHaveBeenCalledWith({
      by: ['status', 'paymentStatus'],
      where: { tutorProfileId: TUTOR_A },
      _count: { _all: true },
      _sum: { netAmount: true },
    });
    expect(bookingGroupBy).toHaveBeenCalledWith({
      by: ['status', 'paymentStatus'],
      where: { tutorProfileId: TUTOR_B },
      _count: { _all: true },
      _sum: { netAmount: true },
    });
    expect(resA.body).toEqual({
      totalBookings: 3,
      statusCounts: {
        PENDING: 0,
        CONFIRMED: 0,
        COMPLETED: 2,
        CANCELED: 1,
        EXPIRED: 0,
      },
      revenue: {
        amount: '905.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 2,
        finalized: 3,
        percent: 66.67,
      },
    });
    expect(resB.body).toEqual({
      totalBookings: 4,
      statusCounts: {
        PENDING: 0,
        CONFIRMED: 0,
        COMPLETED: 0,
        CANCELED: 0,
        EXPIRED: 4,
      },
      revenue: {
        amount: '0.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 0,
        finalized: 0,
        percent: null,
      },
    });
  });
});

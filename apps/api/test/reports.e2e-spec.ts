import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Prisma, Role } from '@generated/prisma/client';
import { BookingStatus } from '@generated/prisma/enums';
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
  const bookingAggregate = jest.fn();
  const transaction = jest.fn();

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
            $transaction: transaction,
            authSession: { findUnique: authSessionFindUnique },
            booking: {
              aggregate: bookingAggregate,
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
    bookingAggregate.mockResolvedValue({ _sum: { netAmount: null } });
    transaction.mockImplementation(
      (work: (tx: { booking: { aggregate: jest.Mock; groupBy: jest.Mock } }) => Promise<unknown>) =>
        work({
          booking: {
            aggregate: bookingAggregate,
            groupBy: bookingGroupBy,
          },
        }),
    );
  });

  it('returns 401 UNAUTHENTICATED when Authorization header is missing', async () => {
    const response = await request(app.getHttpServer()).get(ROUTE).expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });
    expect(transaction).not.toHaveBeenCalled();
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
    expect(transaction).not.toHaveBeenCalled();
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
    expect(transaction).not.toHaveBeenCalled();
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
    expect(transaction).not.toHaveBeenCalled();
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
    expect(transaction).not.toHaveBeenCalled();
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
    expect(transaction).not.toHaveBeenCalled();
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
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns 200 with Cache-Control: no-store and the 12-booking 905.00 THB / 75% report', async () => {
    bookingGroupBy.mockResolvedValue([
      { status: BookingStatus.PENDING, _count: { _all: 3 } },
      { status: BookingStatus.CONFIRMED, _count: { _all: 1 } },
      { status: BookingStatus.COMPLETED, _count: { _all: 6 } },
      { status: BookingStatus.CANCELED, _count: { _all: 2 } },
    ]);
    bookingAggregate.mockResolvedValue({
      _sum: { netAmount: new Prisma.Decimal('905.00') },
    });

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
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
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
    bookingGroupBy.mockResolvedValue([{ status: BookingStatus.EXPIRED, _count: { _all: 3 } }]);

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

  it('isolates report queries per authenticated tutor across concurrent RepeatableRead snapshots', async () => {
    const snapshots = new Map<
      string,
      {
        statuses: Array<{ status: BookingStatus; _count: { _all: number } }>;
        revenue: Prisma.Decimal | null;
      }
    >([
      [
        TUTOR_A,
        {
          statuses: [
            { status: BookingStatus.COMPLETED, _count: { _all: 2 } },
            { status: BookingStatus.CANCELED, _count: { _all: 1 } },
          ],
          revenue: new Prisma.Decimal('905.00'),
        },
      ],
      [
        TUTOR_B,
        {
          statuses: [{ status: BookingStatus.EXPIRED, _count: { _all: 4 } }],
          revenue: null,
        },
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

    const txIsolationCalls: Array<{ isolationLevel?: Prisma.TransactionIsolationLevel }> = [];
    transaction.mockImplementation(
      async (
        work: (tx: { booking: { aggregate: jest.Mock; groupBy: jest.Mock } }) => Promise<unknown>,
        options: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ) => {
        txIsolationCalls.push(options);
        const txGroupBy = jest.fn(async ({ where }: { where: { tutorProfileId: string } }) => {
          // Yield to overlap the two concurrent transactions.
          await new Promise((resolve) =>
            setTimeout(resolve, where.tutorProfileId === TUTOR_A ? 15 : 5),
          );
          return snapshots.get(where.tutorProfileId)?.statuses ?? [];
        });
        const txAggregate = jest.fn(({ where }: { where: { tutorProfileId: string } }) =>
          Promise.resolve({
            _sum: { netAmount: snapshots.get(where.tutorProfileId)?.revenue ?? null },
          }),
        );
        return work({ booking: { aggregate: txAggregate, groupBy: txGroupBy } });
      },
    );

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer()).get(ROUTE).auth('token-a', { type: 'bearer' }).expect(200),
      request(app.getHttpServer()).get(ROUTE).auth('token-b', { type: 'bearer' }).expect(200),
    ]);

    expect(txIsolationCalls).toEqual([
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    ]);
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

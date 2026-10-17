import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { Prisma } from '@generated/prisma/client';
import {
  AccountStatus,
  BookingStatus,
  RescheduleRequestStatus,
  Role,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import {
  BookingRescheduleRequestsController,
  RescheduleRequestsController,
} from '@modules/reschedule-requests/reschedule-requests.controller';
import { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const OUTSIDER_ID = '20000000-0000-4000-8000-000000000002';
const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const REQUEST_ID = '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020';
const ORIGINAL_SLOT_ID = '550e8400-e29b-41d4-a716-446655440000';
const TARGET_SLOT_ID = '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5';
const CREATE_URL = `/api/v1/bookings/${BOOKING_ID}/reschedule-requests`;
const REQUEST_URL = `/api/v1/reschedule-requests/${REQUEST_ID}`;

function bookingFixture(status: BookingStatus = BookingStatus.CONFIRMED) {
  return {
    id: BOOKING_ID,
    listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
    netAmount: new Prisma.Decimal('450.00'),
    slot: {
      startAtUtc: new Date('2026-10-16T12:00:00Z'),
      endAtUtc: new Date('2026-10-16T13:00:00Z'),
    },
    slotId: ORIGINAL_SLOT_ID,
    status,
    studentUserId: STUDENT_ID,
    subtotalAmount: new Prisma.Decimal('450.00'),
    tutorProfileId: TUTOR_ID,
    updatedAt: new Date('2026-10-15T11:00:00Z'),
  };
}

function requestFixture(status: RescheduleRequestStatus = RescheduleRequestStatus.PENDING) {
  return {
    bookingId: BOOKING_ID,
    decidedAt: null,
    fromSlotId: ORIGINAL_SLOT_ID,
    id: REQUEST_ID,
    reason: 'Exam conflict',
    requestedAt: new Date('2026-10-15T10:00:00Z'),
    requestedById: STUDENT_ID,
    requestedSlotId: TARGET_SLOT_ID,
    reviewedById: null,
    status,
    withdrawnAt: null,
  };
}

describe('Reschedule API regressions (HTTP with isolated persistence)', () => {
  let app: INestApplication<App>;
  let booking = bookingFixture();
  let pending = requestFixture();
  let targetDeletedAt: Date | null = null;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const userFindUnique = jest.fn();
  const bookingFindUnique = jest.fn();
  const bookingUpdateMany = jest.fn();
  const requestFindUnique = jest.fn();
  const requestFindFirst = jest.fn();
  const requestCreate = jest.fn();
  const requestUpdateMany = jest.fn();
  const queryRaw = jest.fn();
  const transaction = jest.fn();
  const targetSlot = () => ({
    bookings: [],
    deletedAt: targetDeletedAt,
    endAtUtc: new Date('2026-10-18T13:00:00Z'),
    id: TARGET_SLOT_ID,
    startAtUtc: new Date('2026-10-18T12:00:00Z'),
    tutorProfileId: TUTOR_ID,
  });
  const prisma = {
    $queryRaw: queryRaw,
    $transaction: transaction,
    authSession: { findUnique: authSessionFindUnique },
    availabilitySlot: { findUnique: jest.fn() },
    booking: {
      findFirst: jest.fn(),
      findUnique: bookingFindUnique,
      findUniqueOrThrow: jest.fn(),
      updateMany: bookingUpdateMany,
    },
    rescheduleRequest: {
      create: requestCreate,
      findFirst: requestFindFirst,
      findUnique: requestFindUnique,
      updateMany: requestUpdateMany,
    },
    user: { findUnique: userFindUnique },
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [BookingRescheduleRequestsController, RescheduleRequestsController],
      providers: [
        { provide: NotificationEventsService, useValue: { write: jest.fn() } },
        RescheduleRequestsService,
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => app.close());
  afterEach(() => jest.useRealTimers());

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] });
    jest.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    booking = bookingFixture();
    pending = requestFixture();
    targetDeletedAt = null;
    authenticateAs(STUDENT_ID, Role.STUDENT);
    userFindUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
    });
    bookingFindUnique.mockImplementation(() => Promise.resolve(booking));
    requestFindUnique.mockImplementation(() =>
      Promise.resolve({
        ...pending,
        booking,
        requestedSlot: targetSlot(),
      }),
    );
    requestFindFirst.mockImplementation(() =>
      Promise.resolve({ ...pending, requestedSlot: targetSlot() }),
    );
    requestCreate.mockImplementation(() => Promise.resolve(pending));
    prisma.availabilitySlot.findUnique.mockImplementation(() => Promise.resolve(targetSlot()));
    prisma.booking.findFirst.mockResolvedValue(null);
    prisma.booking.findUniqueOrThrow.mockImplementation(() => Promise.resolve(booking));
    queryRaw.mockImplementation((sql: TemplateStringsArray) =>
      Promise.resolve(
        sql.join('').includes('FROM "AvailabilitySlot"') ? [targetSlot()] : [{ id: BOOKING_ID }],
      ),
    );
    requestUpdateMany.mockImplementation((args: Prisma.RescheduleRequestUpdateManyArgs) => {
      if (pending.status !== RescheduleRequestStatus.PENDING) {
        return Promise.resolve({ count: 0 });
      }
      const status = args.data.status;
      if (typeof status !== 'string') {
        throw new Error('Expected a reschedule decision');
      }
      pending = { ...pending, status };
      return Promise.resolve({ count: 1 });
    });
    bookingUpdateMany.mockImplementation(() => {
      booking = { ...booking, slotId: TARGET_SLOT_ID };
      return Promise.resolve({ count: 1 });
    });
    // Models rollback only. PostgreSQL locks/contending connections are not simulated here.
    transaction.mockImplementation(async (callback: (tx: typeof prisma) => Promise<unknown>) => {
      const savedBooking = { ...booking };
      const savedRequest = { ...pending };
      try {
        return await callback(prisma);
      } catch (error) {
        booking = savedBooking;
        pending = savedRequest;
        throw error;
      }
    });
  });

  it('creates at exactly 24h and advertises CREATE at the same boundary', async () => {
    requestFindFirst.mockResolvedValue(null);
    const current = await authorized('get', `${CREATE_URL}/current`).expect(200);
    expect(current.body).toMatchObject({ allowedActions: ['CREATE'], request: null });
    await authorized('post', CREATE_URL).send({ targetSlotId: TARGET_SLOT_ID }).expect(201);
    expect(booking.slotId).toBe(ORIGINAL_SLOT_ID);
  });

  it('approves at exactly 24h and returns the persisted slot', async () => {
    authenticateAs(TUTOR_ID, Role.TUTOR);
    const current = await authorized('get', `${CREATE_URL}/current`).expect(200);
    expect(current.body).toMatchObject({ allowedActions: ['APPROVE', 'REJECT'] });
    const response = await authorized('post', `${REQUEST_URL}/approve`).expect(200);
    expect(response.body).toMatchObject({
      status: 'APPROVED',
      booking: { slotId: TARGET_SLOT_ID },
      newSlot: { id: TARGET_SLOT_ID },
    });
    expect(pending.status).toBe(RescheduleRequestStatus.APPROVED);
    expect(booking.slotId).toBe(TARGET_SLOT_ID);
    await authorized('post', `${REQUEST_URL}/approve`).expect(409);
  });

  it.each(['cutoff', 'canceled', 'deleted target'])(
    'hides APPROVE for %s and preserves REJECT',
    async (state) => {
      authenticateAs(TUTOR_ID, Role.TUTOR);
      if (state === 'cutoff') {
        booking.slot.startAtUtc = new Date('2026-10-16T11:59:59.999Z');
      } else if (state === 'canceled') {
        booking.status = BookingStatus.CANCELED;
      } else {
        targetDeletedAt = new Date();
      }
      const current = await authorized('get', `${CREATE_URL}/current`).expect(200);
      expect(current.body).toMatchObject({ allowedActions: ['REJECT'] });
      await authorized('post', `${REQUEST_URL}/approve`).expect(409);
      expect(requestUpdateMany).not.toHaveBeenCalled();
      await authorized('post', `${REQUEST_URL}/reject`).send({}).expect(200);
      expect(booking.slotId).toBe(ORIGINAL_SLOT_ID);
    },
  );

  it('returns 409 if target deletion commits between request lookup and slot lock', async () => {
    authenticateAs(TUTOR_ID, Role.TUTOR);
    queryRaw.mockImplementation((sql: TemplateStringsArray) => {
      if (sql.join('').includes('FROM "AvailabilitySlot"')) {
        targetDeletedAt = new Date();
        return Promise.resolve([targetSlot()]);
      }
      return Promise.resolve([{ id: BOOKING_ID }]);
    });
    const response = await authorized('post', `${REQUEST_URL}/approve`).expect(409);
    expect(response.body).toMatchObject({ code: 'RESCHEDULE_TARGET_UNAVAILABLE' });
    expect(requestUpdateMany).not.toHaveBeenCalled();
    expect(bookingUpdateMany).not.toHaveBeenCalled();
    expect(pending.status).toBe(RescheduleRequestStatus.PENDING);
    expect(booking.slotId).toBe(ORIGINAL_SLOT_ID);
  });

  it('rolls back the request if a competing reservation wins the slot', async () => {
    authenticateAs(TUTOR_ID, Role.TUTOR);
    bookingUpdateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Booking_active_slot_key', {
        clientVersion: '7.10.0',
        code: 'P2002',
      }),
    );
    await authorized('post', `${REQUEST_URL}/approve`).expect(409);
    expect(pending.status).toBe(RescheduleRequestStatus.PENDING);
    expect(booking.slotId).toBe(ORIGINAL_SLOT_ID);
  });

  it('allows only the requester to withdraw, without changing the booking', async () => {
    authenticateAs(TUTOR_ID, Role.TUTOR);
    await authorized('post', `${REQUEST_URL}/withdraw`).expect(403);
    authenticateAs(STUDENT_ID, Role.STUDENT);
    await authorized('post', `${REQUEST_URL}/withdraw`).expect(200);
    expect(pending.status).toBe(RescheduleRequestStatus.WITHDRAWN);
    expect(bookingUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects requester approval and outsider decisions before writes', async () => {
    await authorized('post', `${REQUEST_URL}/approve`).expect(403);
    authenticateAs(OUTSIDER_ID, Role.TUTOR);
    await authorized('post', `${REQUEST_URL}/approve`).expect(403);
    await authorized('post', `${REQUEST_URL}/reject`).send({}).expect(403);
    expect(requestUpdateMany).not.toHaveBeenCalled();
    expect(bookingUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects missing authentication before accessing the booking', async () => {
    await request(app.getHttpServer())
      .post(CREATE_URL)
      .send({ targetSlotId: TARGET_SLOT_ID })
      .expect(401);
    expect(bookingFindUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects unknown body fields through the real validation pipe', async () => {
    await authorized('post', CREATE_URL)
      .send({ targetSlotId: TARGET_SLOT_ID, requestedById: OUTSIDER_ID })
      .expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  function authorized(method: 'get' | 'post', url: string): request.Test {
    return request(app.getHttpServer())[method](url).set('Authorization', 'Bearer signed-token');
  }

  function authenticateAs(userId: string, role: Role): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: userId });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date('2026-10-15T13:00:00Z'),
      id: 'session-id',
      revokedAt: null,
      userId,
      user: {
        id: userId,
        role,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: 'participant@example.com',
        emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
  }
});

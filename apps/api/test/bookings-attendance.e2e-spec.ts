import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, AttendanceStatus, BookingStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';

import type { Prisma } from '@generated/prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_TUTOR_ID = '20000000-0000-4000-8000-000000000002';
const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const ATTENDANCE_URL = `/api/v1/bookings/tutor/${BOOKING_ID}/attendance`;

interface BookingFixture {
  attendance: AttendanceStatus | null;
  attendanceMarkedAt: Date | null;
  id: string;
  slot: { endAtUtc: Date };
  status: BookingStatus;
  studentUserId: string;
  tutorProfileId: string;
}

describe('Tutor attendance API (e2e, isolated persistence)', () => {
  let app: INestApplication<App>;
  let booking: BookingFixture | null;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const findUnique = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const updateMany = jest.fn();
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
            booking: { findUnique },
          },
        },
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    booking = {
      attendance: null,
      attendanceMarkedAt: null,
      id: BOOKING_ID,
      slot: { endAtUtc: new Date('2026-01-01T10:00:00.000Z') },
      status: BookingStatus.CONFIRMED,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
    };
    authenticateAs(Role.TUTOR);
    findUnique.mockImplementation(() => Promise.resolve(structuredClone(booking)));
    findUniqueOrThrow.mockImplementation(() => Promise.resolve(structuredClone(booking)));
    updateMany.mockImplementation((args: Prisma.BookingUpdateManyArgs) => {
      if (!booking || booking.status !== BookingStatus.CONFIRMED || booking.attendance !== null) {
        return Promise.resolve({ count: 0 });
      }
      const { attendance, attendanceMarkedAt, status } = args.data;
      if (
        (attendance !== AttendanceStatus.ATTENDED && attendance !== AttendanceStatus.ABSENT) ||
        !(attendanceMarkedAt instanceof Date) ||
        status !== BookingStatus.COMPLETED
      ) {
        throw new Error('Unexpected attendance write');
      }
      booking = { ...booking, attendance, attendanceMarkedAt, status };
      return Promise.resolve({ count: 1 });
    });
    // Models rollback after a write/read failure; PostgreSQL contention needs a live DB check.
    transaction.mockImplementation(
      async (
        callback: (tx: {
          booking: {
            findUnique: typeof findUnique;
            findUniqueOrThrow: typeof findUniqueOrThrow;
            updateMany: typeof updateMany;
          };
        }) => Promise<unknown>,
      ) => {
        const snapshot = structuredClone(booking);
        try {
          return await callback({ booking: { findUnique, findUniqueOrThrow, updateMany } });
        } catch (error) {
          booking = snapshot;
          throw error;
        }
      },
    );
  });

  it.each([AttendanceStatus.ATTENDED, AttendanceStatus.ABSENT])(
    'saves %s once and returns the original record on replay',
    async (attendance) => {
      const first = await attendanceRequest().send({ attendance }).expect(200);
      const saved = structuredClone(booking);
      expect(first.body).toEqual({
        attendance,
        attendanceMarkedAt: saved?.attendanceMarkedAt?.toISOString(),
        bookingId: BOOKING_ID,
        idempotentReplay: false,
        status: BookingStatus.COMPLETED,
      });
      const repeat = await attendanceRequest().send({ attendance }).expect(200);
      expect(repeat.body).toEqual({ ...first.body, idempotentReplay: true });
      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(booking).toEqual(saved);
    },
  );

  it('returns 409 without changing the record when the attendance differs', async () => {
    await attendanceRequest().send({ attendance: AttendanceStatus.ATTENDED }).expect(200);
    const saved = structuredClone(booking);
    const response = await attendanceRequest()
      .send({ attendance: AttendanceStatus.ABSENT })
      .expect(409);
    expect(response.body).toMatchObject({ code: 'ATTENDANCE_ALREADY_RECORDED', statusCode: 409 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(booking).toEqual(saved);
  });

  it('returns 401 before any booking access when the JWT is missing', async () => {
    await request(app.getHttpServer())
      .put(ATTENDANCE_URL)
      .send({ attendance: 'ATTENDED' })
      .expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid JWT before any booking access', async () => {
    verifyAccessToken.mockReturnValue(null);
    await attendanceRequest().send({ attendance: 'ATTENDED' }).expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.ADMIN])(
    'returns 403 for role %s before booking access',
    async (role) => {
      authenticateAs(role);
      await attendanceRequest().send({ attendance: 'ATTENDED' }).expect(403);
      expect(findUnique).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('returns 403 for another tutor without mutation', async () => {
    authenticateAs(Role.TUTOR, OTHER_TUTOR_ID);
    const saved = structuredClone(booking);
    const response = await attendanceRequest().send({ attendance: 'ATTENDED' }).expect(403);
    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_OWNED', statusCode: 403 });
    expect(transaction).not.toHaveBeenCalled();
    expect(booking).toEqual(saved);
  });

  it('returns 404 for a missing booking', async () => {
    booking = null;
    const response = await attendanceRequest().send({ attendance: 'ATTENDED' }).expect(404);
    expect(response.body).toMatchObject({ code: 'BOOKING_NOT_FOUND', statusCode: 404 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed booking ID before booking access', async () => {
    await attendanceRequest('/api/v1/bookings/tutor/not-a-uuid/attendance')
      .send({ attendance: 'ATTENDED' })
      .expect(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { attendance: 'PRESENT' },
    { attendance: null },
    { attendance: 'ATTENDED', tutorId: OTHER_TUTOR_ID },
  ])('rejects an invalid body %p without mutation', async (body) => {
    const saved = structuredClone(booking);
    const response = await attendanceRequest().send(body).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
    expect(booking).toEqual(saved);
  });

  it.each([BookingStatus.PENDING, BookingStatus.CANCELED, BookingStatus.EXPIRED])(
    'rejects state %s without mutation',
    async (status) => {
      if (booking) {
        booking.status = status;
      }
      const saved = structuredClone(booking);
      const response = await attendanceRequest().send({ attendance: 'ATTENDED' }).expect(409);
      expect(response.body).toMatchObject({
        code: 'BOOKING_NOT_CONFIRMED_OR_COMPLETED',
        statusCode: 409,
      });
      expect(updateMany).not.toHaveBeenCalled();
      expect(booking).toEqual(saved);
    },
  );

  it('rejects a future class without mutation', async () => {
    if (booking) {
      booking.slot.endAtUtc = new Date('2099-01-01T10:00:00.000Z');
    }
    const saved = structuredClone(booking);
    const response = await attendanceRequest().send({ attendance: 'ATTENDED' }).expect(409);
    expect(response.body).toMatchObject({ code: 'CLASS_NOT_ENDED', statusCode: 409 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(booking).toEqual(saved);
  });

  it('rolls back attendance, timestamp and completion if the post-write read fails', async () => {
    const saved = structuredClone(booking);
    findUniqueOrThrow.mockRejectedValueOnce(new Error('Read failed after write'));
    await attendanceRequest().send({ attendance: 'ATTENDED' }).expect(500);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(booking).toEqual(saved);
  });

  function attendanceRequest(url = ATTENDANCE_URL): request.Test {
    return request(app.getHttpServer()).put(url).set('Authorization', 'Bearer signed-token');
  }

  function authenticateAs(role: Role, userId = TUTOR_ID): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: userId });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: 'tutor@example.com',
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        id: userId,
        role,
      },
      userId,
    });
  }
});

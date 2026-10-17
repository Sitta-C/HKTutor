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
import { NotificationEventsService } from '@modules/notifications/notification-events.service';

import type { Prisma } from '@generated/prisma/client';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '20000000-0000-4000-8000-000000000002';
const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
const SUBJECT = { id: '11dafbfa-89bc-4e09-a89a-873c419140bd', name: 'Mathematics' };
const MEETING_URL = 'https://meet.example.com/private-class';
const UPDATED_URL = 'https://meet.example.com/replacement';
const CLASS_URL = `/api/v1/bookings/${BOOKING_ID}/class-details`;
const EDIT_URL = `/api/v1/bookings/tutor/${BOOKING_ID}/meeting-link`;
const UPDATED_AT = new Date('2026-10-17T09:00:00.000Z');
const STUDENT_DETAIL = {
  firstName: 'Suda',
  lastName: 'Dee',
  nickname: 'Da',
  school: 'Demo School',
  gradeLevel: 'Grade 10',
  phone: '0812345678',
};
const TUTOR_DETAIL = {
  firstName: 'Anan',
  lastName: 'Suksawat',
  nickname: 'Nan',
  displayName: 'Kru Anan',
  bio: 'Mathematics tutor',
  experienceYears: 5,
};

interface BookingFixture {
  id: string;
  status: BookingStatus;
  studentUserId: string;
  tutorProfileId: string;
  meetingUrl: string | null;
  attendance: AttendanceStatus | null;
  updatedAt: Date;
  slot: { startAtUtc: Date; endAtUtc: Date };
  listing: { subject: typeof SUBJECT };
  tutorProfile: typeof TUTOR_DETAIL;
}

// Exercises the HTTP boundary and real guards; persistence and token verification are isolated.
// PostgreSQL rollback/locking behavior requires a separate disposable-database verification.
describe('Meeting links and participant class details (S2-T32)', () => {
  let app: INestApplication<App>;
  let booking: BookingFixture | null;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const studentFindFirst = jest.fn();
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
        { provide: NotificationEventsService, useValue: { write: jest.fn() } },
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: {
            $transaction: transaction,
            authSession: { findUnique: authSessionFindUnique },
            booking: { findFirst, findUnique },
            studentProfile: { findFirst: studentFindFirst },
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
      id: BOOKING_ID,
      status: BookingStatus.CONFIRMED,
      studentUserId: STUDENT_ID,
      tutorProfileId: TUTOR_ID,
      meetingUrl: MEETING_URL,
      attendance: null,
      updatedAt: new Date('2026-10-16T09:00:00.000Z'),
      slot: {
        startAtUtc: new Date('2026-10-16T18:00:00.000Z'),
        endAtUtc: new Date('2026-10-16T19:00:00.000Z'),
      },
      listing: { subject: SUBJECT },
      tutorProfile: TUTOR_DETAIL,
    };
    authenticateAs(Role.TUTOR, TUTOR_ID);
    findUnique.mockImplementation(() => Promise.resolve(structuredClone(booking)));
    findFirst.mockImplementation(() => Promise.resolve(structuredClone(booking)));
    findUniqueOrThrow.mockImplementation(() => Promise.resolve(structuredClone(booking)));
    // Include database metadata to catch accidentally serializing a whole profile again.
    studentFindFirst.mockResolvedValue({
      ...STUDENT_DETAIL,
      userId: STUDENT_ID,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    });
    updateMany.mockImplementation((args: Prisma.BookingUpdateManyArgs) => {
      if (!booking) return Promise.resolve({ count: 0 });
      const allowed = args.where?.status;
      if (
        typeof allowed !== 'object' ||
        !Array.isArray(allowed.in) ||
        !allowed.in.includes(booking.status)
      ) {
        return Promise.resolve({ count: 0 });
      }
      if (typeof args.data.meetingUrl !== 'string') throw new Error('Unexpected meeting URL');
      booking = { ...booking, meetingUrl: args.data.meetingUrl, updatedAt: UPDATED_AT };
      return Promise.resolve({ count: 1 });
    });
    transaction.mockImplementation(
      async (
        callback: (tx: {
          booking: { updateMany: typeof updateMany; findUniqueOrThrow: typeof findUniqueOrThrow };
        }) => Promise<unknown>,
      ) => {
        const snapshot = structuredClone(booking);
        try {
          return await callback({ booking: { updateMany, findUniqueOrThrow } });
        } catch (error) {
          booking = snapshot;
          throw error;
        }
      },
    );
  });

  it.each([Role.STUDENT, Role.TUTOR])(
    'returns the participant projection in every state to %s',
    async (role) => {
      authenticateAs(role, role === Role.STUDENT ? STUDENT_ID : TUTOR_ID);
      for (const status of Object.values(BookingStatus)) {
        if (!booking) throw new Error('Missing fixture');
        booking.status = status;
        booking.attendance = status === BookingStatus.COMPLETED ? AttendanceStatus.ATTENDED : null;
        const saved = structuredClone(booking);
        const response = await readClass().expect(200);
        expect(response.body).toEqual({
          bookingId: BOOKING_ID,
          status,
          startAt: '2026-10-16T18:00:00.000Z',
          endAt: '2026-10-16T19:00:00.000Z',
          subject: SUBJECT,
          attendance: saved.attendance,
          meetingUrl:
            status === BookingStatus.CONFIRMED || status === BookingStatus.COMPLETED
              ? MEETING_URL
              : null,
          participants: {
            tutor: { id: TUTOR_ID, detail: TUTOR_DETAIL },
            student: { id: STUDENT_ID, detail: STUDENT_DETAIL },
          },
        });
        expect(booking).toEqual(saved);
      }
      expect(transaction).not.toHaveBeenCalled();
      expect(studentFindFirst).toHaveBeenCalledWith({
        where: { userId: STUDENT_ID },
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          school: true,
          gradeLevel: true,
          phone: true,
        },
      });
    },
  );

  it.each([BookingStatus.CONFIRMED, BookingStatus.COMPLETED])(
    'accepts a missing link for %s',
    async (status) => {
      if (!booking) throw new Error('Missing fixture');
      booking.status = status;
      booking.meetingUrl = null;
      const response = await readClass().expect(200);
      expect(response.body).toMatchObject({ status, subject: SUBJECT, meetingUrl: null });
    },
  );

  it.each([BookingStatus.CONFIRMED, BookingStatus.COMPLETED])(
    'updates only the link and timestamp for %s and reads the saved value',
    async (status) => {
      if (!booking) throw new Error('Missing fixture');
      booking.status = status;
      const saved = structuredClone(booking);
      const response = await editLink().send({ meetingUrl: UPDATED_URL }).expect(200);
      expect(response.body).toEqual({
        bookingId: BOOKING_ID,
        meetingUrl: UPDATED_URL,
        updatedAt: UPDATED_AT.toISOString(),
      });
      expect(booking).toEqual({ ...saved, meetingUrl: UPDATED_URL, updatedAt: UPDATED_AT });
      expect(updateMany).toHaveBeenCalledWith({
        data: { meetingUrl: UPDATED_URL },
        where: {
          id: BOOKING_ID,
          status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED] },
        },
      });
      authenticateAs(Role.STUDENT, STUDENT_ID);
      const read = await readClass().expect(200);
      expect(read.body).toMatchObject({ status, meetingUrl: UPDATED_URL, subject: SUBJECT });
    },
  );

  it.each([BookingStatus.PENDING, BookingStatus.CANCELED, BookingStatus.EXPIRED])(
    'rejects a write to %s without mutation',
    async (status) => {
      if (!booking) throw new Error('Missing fixture');
      booking.status = status;
      const saved = structuredClone(booking);
      const response = await editLink().send({ meetingUrl: UPDATED_URL }).expect(409);
      expect(response.body).toMatchObject({
        statusCode: 409,
        code: 'BOOKING_NOT_CONFIRMED_OR_COMPLETED',
      });
      expect(transaction).not.toHaveBeenCalled();
      expect(booking).toEqual(saved);
    },
  );

  it.each([
    {},
    { meetingUrl: null },
    { meetingUrl: 42 },
    { meetingUrl: '' },
    { meetingUrl: 'http://example.com' },
    { meetingUrl: 'ftp://example.com' },
    { meetingUrl: 'javascript:alert(1)' },
    { meetingUrl: 'https:/example.com' },
    { meetingUrl: 'https://' },
    { meetingUrl: ' https://example.com ' },
    { meetingUrl: UPDATED_URL, tutorUserId: TUTOR_ID },
  ])('rejects invalid input %p without mutation', async (body) => {
    const saved = structuredClone(booking);
    const response = await editLink().send(body).expect(400);
    expect(response.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    expect(transaction).not.toHaveBeenCalled();
    expect(booking).toEqual(saved);
  });

  it.each([Role.STUDENT, Role.TUTOR, Role.ADMIN])(
    'blocks writes from a non-owning %s without leaking class data',
    async (role) => {
      authenticateAs(role, role === Role.STUDENT ? STUDENT_ID : OTHER_USER_ID);
      const saved = structuredClone(booking);
      const response = await editLink().send({ meetingUrl: UPDATED_URL }).expect(403);
      expect(response.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
      expect(JSON.stringify(response.body)).not.toContain(MEETING_URL);
      expect(findFirst).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(booking).toEqual(saved);
    },
  );

  it.each([Role.STUDENT, Role.TUTOR, Role.ADMIN])(
    'blocks reads from a nonparticipant %s without loading class data',
    async (role) => {
      authenticateAs(role, OTHER_USER_ID);
      const response = await readClass().expect(403);
      expect(response.body).toMatchObject({ statusCode: 403, code: 'BOOKING_NOT_OWNED' });
      expect(JSON.stringify(response.body)).not.toContain(MEETING_URL);
      expect(findFirst).not.toHaveBeenCalled();
      expect(studentFindFirst).not.toHaveBeenCalled();
    },
  );

  it('rejects missing and invalid JWTs before booking access', async () => {
    for (const method of ['get', 'put'] as const) {
      const url = method === 'get' ? CLASS_URL : EDIT_URL;
      await request(app.getHttpServer())[method](url).expect(401);
      verifyAccessToken.mockReturnValue(null);
      const response = await request(app.getHttpServer())
        [method](url)
        .set('Authorization', 'Bearer invalid')
        .expect(401);
      expect(response.body).toMatchObject({ statusCode: 401, code: 'UNAUTHENTICATED' });
    }
    expect(findUnique).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs and missing bookings consistently', async () => {
    await readClass('/api/v1/bookings/bad/class-details').expect(400);
    await editLink('/api/v1/bookings/tutor/bad/meeting-link')
      .send({ meetingUrl: UPDATED_URL })
      .expect(400);
    expect(findUnique).not.toHaveBeenCalled();
    booking = null;
    for (const response of [
      await readClass().expect(404),
      await editLink().send({ meetingUrl: UPDATED_URL }).expect(404),
    ]) {
      expect(response.body).toMatchObject({ statusCode: 404, code: 'BOOKING_NOT_FOUND' });
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a concurrent cancellation without overwriting the saved link', async () => {
    const saved = structuredClone(booking);
    transaction.mockImplementationOnce(
      async (
        callback: (tx: { booking: { updateMany: typeof updateMany } }) => Promise<unknown>,
      ) => {
        if (!booking) throw new Error('Missing fixture');
        booking.status = BookingStatus.CANCELED;
        return callback({ booking: { updateMany } });
      },
    );
    const response = await editLink().send({ meetingUrl: UPDATED_URL }).expect(409);
    expect(response.body).toMatchObject({ code: 'BOOKING_TRANSITION_CONFLICT', statusCode: 409 });
    expect(booking).toEqual({ ...saved, status: BookingStatus.CANCELED });
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rolls back the link and timestamp if the post-write read fails', async () => {
    const saved = structuredClone(booking);
    findUniqueOrThrow.mockRejectedValueOnce(new Error('Read failed after write'));
    await editLink().send({ meetingUrl: UPDATED_URL }).expect(500);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(booking).toEqual(saved);
  });

  function readClass(url = CLASS_URL): request.Test {
    return request(app.getHttpServer()).get(url).set('Authorization', 'Bearer signed-token');
  }

  function editLink(url = EDIT_URL): request.Test {
    return request(app.getHttpServer()).put(url).set('Authorization', 'Bearer signed-token');
  }

  function authenticateAs(role: Role, userId: string): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: userId });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      id: 'session-id',
      revokedAt: null,
      userId,
      user: {
        id: userId,
        email: 'fixture@example.com',
        role,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  }
});

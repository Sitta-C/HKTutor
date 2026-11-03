import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  ReviewController,
  ReviewsController,
  TutorReviewsController,
} from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const BOOKING_ID = '40000000-0000-4000-8000-000000000001';
const TUTOR_ID = '50000000-0000-4000-8000-000000000001';
const URL = `/api/v1/bookings/me/${BOOKING_ID}/reviews`;
const GET_URL = `/api/v1/bookings/me/${BOOKING_ID}/review`;
const PUBLIC_URL = `/api/v1/tutors/${TUTOR_ID}/reviews`;
const VALID_BODY = { clarity: 5, feedback: 'Clear examples', preparation: 5, punctuality: 4 };
const SAVED_REVIEW = {
  clarity: 5,
  createdAt: '2026-11-10T11:00:00.000Z',
  feedback: 'Clear examples',
  id: '60000000-0000-4000-8000-000000000001',
  overallRating: 4.67,
  preparation: 5,
  punctuality: 4,
};
const PUBLIC_REVIEW = { ...SAVED_REVIEW, author: { displayName: 'Nan' } };

describe('Reviews HTTP contract', () => {
  let app: INestApplication<App>;
  const reviews = { create: jest.fn(), findMine: jest.fn(), listForTutor: jest.fn() };
  const verifyAccessToken = jest.fn();
  const session = jest.fn();
  const booking = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReviewsController, ReviewController, TutorReviewsController],
      providers: [
        { provide: ReviewsService, useValue: reviews },
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: { authSession: { findUnique: session }, booking: { findUnique: booking } },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    authenticate(Role.STUDENT);
    booking.mockResolvedValue({ studentUserId: STUDENT_ID, tutorProfileId: 'tutor' });
    reviews.create.mockResolvedValue({ review: SAVED_REVIEW });
    reviews.findMine.mockResolvedValue({ review: SAVED_REVIEW });
    reviews.listForTutor.mockResolvedValue({ items: [PUBLIC_REVIEW], nextCursor: null });
  });

  it('requires authentication', async () => {
    const response = await request(app.getHttpServer()).post(URL).send(VALID_BODY).expect(401);
    expect((response.body as { code: string }).code).toBe('UNAUTHENTICATED');
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it.each([Role.TUTOR, Role.ADMIN])('rejects the %s role', async (role) => {
    authenticate(role);
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('rejects a foreign booking as 403 BOOKING_NOT_OWNED before calling the service', async () => {
    booking.mockResolvedValue({ studentUserId: 'someone-else', tutorProfileId: 'tutor' });
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(403);
    expect((response.body as { code: string }).code).toBe('BOOKING_NOT_OWNED');
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('answers 404 NOT_FOUND for a missing booking and 400 INVALID_UUID for an invalid UUID', async () => {
    booking.mockResolvedValue(null);
    const missing = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(404);
    expect((missing.body as { code: string }).code).toBe('NOT_FOUND');
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/bookings/me/not-a-uuid/reviews')
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(400);
    expect((invalid.body as { code: string }).code).toBe('INVALID_UUID');
  });

  it('creates a review and disables caching on the response', async () => {
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(201)
      .expect('Cache-Control', 'no-store');
    const body = response.body as { review: { overallRating: number } };
    expect(body.review).toMatchObject({ overallRating: 4.67 });
    expect(reviews.create).toHaveBeenCalledWith(BOOKING_ID, STUDENT_ID, VALID_BODY);
  });

  it('passes the booking-state and duplicate conflicts through unchanged', async () => {
    reviews.create.mockRejectedValue(
      new ConflictException({ code: 'BOOKING_NOT_COMPLETED', message: 'not completed' }),
    );
    const notCompleted = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(409);
    expect((notCompleted.body as { code: string }).code).toBe('BOOKING_NOT_COMPLETED');

    reviews.create.mockRejectedValue(
      new ConflictException({ code: 'REVIEW_ALREADY_EXISTS', message: 'already exists' }),
    );
    const alreadyExists = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(409);
    expect((alreadyExists.body as { code: string }).code).toBe('REVIEW_ALREADY_EXISTS');
  });

  it.each([
    ['missing', { ...VALID_BODY, clarity: undefined }],
    ['zero', { ...VALID_BODY, clarity: 0 }],
    ['above range', { ...VALID_BODY, clarity: 6 }],
    ['a fraction', { ...VALID_BODY, clarity: 4.5 }],
    ['a numeric string', { ...VALID_BODY, clarity: '5' }],
  ])('rejects a rating that is %s', async (_label, body) => {
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('accepts the boundary ratings 1 and 5', async () => {
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, clarity: 1, preparation: 5, punctuality: 1 })
      .expect(201);
    expect(reviews.create).toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])('rejects %s feedback', async (_label, feedback) => {
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, feedback })
      .expect(400);
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('stores and returns markup-looking feedback as literal text, never interpreted', async () => {
    const markup = '<b>Great tutor</b> & "quotes"';
    reviews.create.mockResolvedValue({ review: { ...SAVED_REVIEW, feedback: markup } });
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, feedback: markup })
      .expect(201);
    expect(reviews.create).toHaveBeenCalledWith(
      BOOKING_ID,
      STUDENT_ID,
      expect.objectContaining({ feedback: markup }),
    );
    expect((response.body as { review: { feedback: string } }).review.feedback).toBe(markup);
  });

  it('rejects blank feedback and feedback over 1000 Unicode code points, accepts exactly 1000', async () => {
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, feedback: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, feedback: '😀'.repeat(1001) })
      .expect(400);
    expect(reviews.create).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, feedback: '😀'.repeat(1000) })
      .expect(201);
    expect(reviews.create).toHaveBeenCalledWith(
      BOOKING_ID,
      STUDENT_ID,
      expect.objectContaining({ feedback: '😀'.repeat(1000) }),
    );
  });

  it('rejects unknown and aggregate fields', async () => {
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, overallRating: 5 })
      .expect(400);
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...VALID_BODY, authorStudentUserId: STUDENT_ID })
      .expect(400);
    expect(reviews.create).not.toHaveBeenCalled();
  });

  describe('GET /bookings/me/:bookingId/review', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get(GET_URL).expect(401);
      expect(reviews.findMine).not.toHaveBeenCalled();
    });

    it.each([Role.TUTOR, Role.ADMIN])('rejects the %s role', async (role) => {
      authenticate(role);
      await request(app.getHttpServer()).get(GET_URL).auth('test', { type: 'bearer' }).expect(403);
      expect(reviews.findMine).not.toHaveBeenCalled();
    });

    it('rejects a foreign booking as 403 before calling the service', async () => {
      booking.mockResolvedValue({ studentUserId: 'someone-else', tutorProfileId: 'tutor' });
      await request(app.getHttpServer()).get(GET_URL).auth('test', { type: 'bearer' }).expect(403);
      expect(reviews.findMine).not.toHaveBeenCalled();
    });

    it('answers 404 for a missing booking and 400 for an invalid UUID', async () => {
      booking.mockResolvedValue(null);
      await request(app.getHttpServer()).get(GET_URL).auth('test', { type: 'bearer' }).expect(404);
      await request(app.getHttpServer())
        .get('/api/v1/bookings/me/not-a-uuid/review')
        .auth('test', { type: 'bearer' })
        .expect(400);
    });

    it('returns the saved review and disables caching, taking identity from the session', async () => {
      const response = await request(app.getHttpServer())
        .get(GET_URL)
        .auth('test', { type: 'bearer' })
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(response.body as { review: unknown }).toEqual({ review: SAVED_REVIEW });
      expect(reviews.findMine).toHaveBeenCalledWith(BOOKING_ID, STUDENT_ID);
    });

    it('answers 200 with a null review rather than 404 when none was submitted yet', async () => {
      reviews.findMine.mockResolvedValue({ review: null });
      const response = await request(app.getHttpServer())
        .get(GET_URL)
        .auth('test', { type: 'bearer' })
        .expect(200);
      expect(response.body as { review: unknown }).toEqual({ review: null });
    });
  });

  describe('GET /tutors/:tutorId/reviews', () => {
    it('requires no authentication', async () => {
      await request(app.getHttpServer()).get(PUBLIC_URL).expect(200);
      expect(reviews.listForTutor).toHaveBeenCalledWith(TUTOR_ID, {});
    });

    it('returns the public review shape and does not set Cache-Control', async () => {
      const response = await request(app.getHttpServer()).get(PUBLIC_URL).expect(200);
      expect(response.headers['cache-control']).toBeUndefined();
      expect(response.body as { items: unknown }).toEqual({
        items: [PUBLIC_REVIEW],
        nextCursor: null,
      });
    });

    it('answers 404 for a hidden or missing tutor the same as for an invalid request', async () => {
      reviews.listForTutor.mockRejectedValue(new NotFoundException('Tutor not found'));
      await request(app.getHttpServer()).get(PUBLIC_URL).expect(404);
    });

    it('answers 400 INVALID_UUID for an invalid tutor UUID without calling the service', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/tutors/not-a-uuid/reviews')
        .expect(400);
      expect((response.body as { code: string }).code).toBe('INVALID_UUID');
      expect(reviews.listForTutor).not.toHaveBeenCalled();
    });

    it('rejects an unknown query field', async () => {
      await request(app.getHttpServer()).get(PUBLIC_URL).query({ status: 'PUBLISHED' }).expect(400);
      expect(reviews.listForTutor).not.toHaveBeenCalled();
    });

    it.each([
      ['zero', 0],
      ['51', 51],
      ['a fraction', 2.5],
    ])('rejects a limit that is %s', async (_label, limit) => {
      await request(app.getHttpServer()).get(PUBLIC_URL).query({ limit }).expect(400);
      expect(reviews.listForTutor).not.toHaveBeenCalled();
    });

    it('accepts the boundary limits 1 and 50 and forwards a cursor', async () => {
      await request(app.getHttpServer()).get(PUBLIC_URL).query({ limit: 1 }).expect(200);
      expect(reviews.listForTutor).toHaveBeenCalledWith(TUTOR_ID, { limit: 1 });
      await request(app.getHttpServer())
        .get(PUBLIC_URL)
        .query({ cursor: 'opaque-cursor', limit: 50 })
        .expect(200);
      expect(reviews.listForTutor).toHaveBeenCalledWith(TUTOR_ID, {
        cursor: 'opaque-cursor',
        limit: 50,
      });
    });

    it('passes a service-rejected foreign-tutor cursor through as 400', async () => {
      reviews.listForTutor.mockRejectedValue(new BadRequestException('Invalid review list cursor'));
      await request(app.getHttpServer())
        .get(PUBLIC_URL)
        .query({ cursor: 'cursor-for-another-tutor' })
        .expect(400);
    });
  });

  function authenticate(role: Role): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: STUDENT_ID });
    session.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: 'student@example.test',
        emailVerifiedAt: new Date(),
        id: STUDENT_ID,
        role,
      },
      userId: STUDENT_ID,
    });
  }
});

import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { ReviewsController } from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const BOOKING_ID = '40000000-0000-4000-8000-000000000001';
const URL = `/api/v1/bookings/me/${BOOKING_ID}/reviews`;
const VALID_BODY = { clarity: 5, feedback: 'Clear examples', preparation: 5, punctuality: 4 };

describe('Reviews HTTP contract', () => {
  let app: INestApplication<App>;
  const reviews = { create: jest.fn() };
  const verifyAccessToken = jest.fn();
  const session = jest.fn();
  const booking = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReviewsController],
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
    reviews.create.mockResolvedValue({
      review: {
        clarity: 5,
        createdAt: '2026-11-10T11:00:00.000Z',
        feedback: 'Clear examples',
        id: '60000000-0000-4000-8000-000000000001',
        overallRating: 4.67,
        preparation: 5,
        punctuality: 4,
      },
    });
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).post(URL).send(VALID_BODY).expect(401);
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it.each([Role.TUTOR, Role.ADMIN])('rejects the %s role', async (role) => {
    authenticate(role);
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(403);
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('rejects a foreign booking as 403 before calling the service', async () => {
    booking.mockResolvedValue({ studentUserId: 'someone-else', tutorProfileId: 'tutor' });
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(403);
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing booking and 400 for an invalid UUID', async () => {
    booking.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/bookings/me/not-a-uuid/reviews')
      .auth('test', { type: 'bearer' })
      .send(VALID_BODY)
      .expect(400);
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

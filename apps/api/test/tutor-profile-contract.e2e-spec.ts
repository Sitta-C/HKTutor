import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';
import { ProfilesController } from '@/profiles/profiles.controller';
import { ProfilesService } from '@/profiles/profiles.service';
import { TutorsPrivateController } from '@/tutors/tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

import type { AuthenticatedRequest } from '@/auth/auth.guard';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const MISSING_LISTING_ID = '10000000-0000-4000-8000-000000000099';
const OTHER_LISTING_ID = '10000000-0000-4000-8000-000000000002';

const subject = {
  active: true,
  code: 'MATH',
  id: '30000000-0000-4000-8000-000000000001',
  name: 'Mathematics',
};

const gradeLevel = {
  active: true,
  code: 'G10',
  id: '40000000-0000-4000-8000-000000000001',
  name: 'Grade 10',
  sortOrder: 10,
};

function listing(pricePerHour = 450.5) {
  return {
    createdAt: new Date('2026-09-10T01:00:00.000Z'),
    description: 'Experienced mathematics tutor.',
    gradeLevel,
    id: LISTING_ID,
    pricePerHour: { toNumber: () => pricePerHour },
    publicationStatus: 'DRAFT',
    publishedAt: null,
    subject,
    updatedAt: new Date('2026-09-10T02:00:00.000Z'),
  };
}

describe('Tutor and profile contracts (e2e)', () => {
  let app: INestApplication<App>;
  const teachingListingFindFirst = jest.fn();
  const teachingListingFindMany = jest.fn();
  const teachingListingUpdate = jest.fn();
  const userFindUnique = jest.fn();

  beforeAll(async () => {
    const prisma = {
      gradeLevel: { findFirst: jest.fn() },
      subject: { findFirst: jest.fn() },
      teachingListing: {
        findFirst: teachingListingFindFirst,
        findMany: teachingListingFindMany,
        update: teachingListingUpdate,
      },
      tutorProfile: { findUnique: jest.fn() },
      user: { findUnique: userFindUnique },
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ProfilesController, TutorsPrivateController],
      providers: [
        ProfilesService,
        ResourceOwnershipGuard,
        TutorsService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          req.auth = {
            email: 'tutor@example.com',
            id: USER_ID,
            role: Role.TUTOR,
            sessionId: 'session-id',
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns the canonical listing response from list and detail endpoints', async () => {
    teachingListingFindMany.mockResolvedValue([listing()]);
    teachingListingFindFirst.mockResolvedValue(listing());

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/tutors/me/listings')
      .expect(200);
    const detailResponse = await request(app.getHttpServer())
      .get(`/api/v1/tutors/me/listings/${LISTING_ID}`)
      .expect(200);
    const expected = {
      createdAt: '2026-09-10T01:00:00.000Z',
      description: 'Experienced mathematics tutor.',
      gradeLevel,
      id: LISTING_ID,
      pricePerHour: 450.5,
      publicationStatus: 'DRAFT',
      publishedAt: null,
      subject,
      updatedAt: '2026-09-10T02:00:00.000Z',
    };

    expect(listResponse.body).toEqual([expected]);
    expect(detailResponse.body).toEqual(expected);
    expect(detailResponse.body).not.toHaveProperty('listingId');
  });

  it.each([
    ['an empty body', {}],
    ['an unknown field', { title: 'Not part of the listing contract' }],
  ])('rejects listing PATCH with %s', async (_label, body) => {
    teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });

    await request(app.getHttpServer())
      .patch(`/api/v1/tutors/me/listings/${LISTING_ID}`)
      .send(body)
      .expect(400);
    expect(teachingListingUpdate).not.toHaveBeenCalled();
  });

  it('accepts a listing PATCH with one valid partial field', async () => {
    teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });
    teachingListingUpdate.mockResolvedValue(listing(500));

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tutors/me/listings/${LISTING_ID}`)
      .send({ pricePerHour: 500 })
      .expect(200);

    expect(response.body).toMatchObject({ id: LISTING_ID, pricePerHour: 500 });
  });

  it('archives an owned listing through the status endpoint', async () => {
    teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });
    teachingListingUpdate.mockResolvedValue({
      ...listing(),
      publicationStatus: 'ARCHIVED',
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/tutors/me/listings/${LISTING_ID}/status`)
      .send({ publicationStatus: 'ARCHIVED' })
      .expect(200);

    expect(response.body).toMatchObject({ id: LISTING_ID, publicationStatus: 'ARCHIVED' });
    expect(teachingListingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { publicationStatus: 'ARCHIVED' } }),
    );
  });

  it('rejects an invalid listing status before updating the database', async () => {
    teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });

    await request(app.getHttpServer())
      .patch(`/api/v1/tutors/me/listings/${LISTING_ID}/status`)
      .send({ publicationStatus: 'DELETED' })
      .expect(400);

    expect(teachingListingUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_UUID for malformed listing IDs without a resource query', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tutors/me/listings/not-a-uuid')
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'INVALID_UUID',
      message: 'listingId must be a valid UUID',
      statusCode: 400,
    });
    expect(teachingListingFindFirst).not.toHaveBeenCalled();
  });

  it('returns the same 404 for missing and cross-owner listing IDs', async () => {
    teachingListingFindFirst.mockResolvedValue(null);

    const missing = await request(app.getHttpServer())
      .get(`/api/v1/tutors/me/listings/${MISSING_LISTING_ID}`)
      .expect(404);
    const crossOwner = await request(app.getHttpServer())
      .get(`/api/v1/tutors/me/listings/${OTHER_LISTING_ID}`)
      .expect(404);

    expect(missing.body).toEqual(crossOwner.body);
    expect(missing.body).toMatchObject({ message: 'Resource not found', statusCode: 404 });
  });

  it('returns the documented 404 when the authenticated profile account is missing', async () => {
    userFindUnique.mockResolvedValue(null);

    const response = await request(app.getHttpServer()).get('/api/v1/profiles/me').expect(404);

    expect(response.body).toMatchObject({ message: 'Account not found', statusCode: 404 });
  });
});

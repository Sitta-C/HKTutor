import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { CatalogController } from '@/tutors/catalog.controller';
import { PublicTutorsController } from '@/tutors/public-tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';

describe('Public Tutor discovery APIs (e2e)', () => {
  let app: INestApplication<App>;
  const service = {
    getActiveGradeLevels: jest.fn(),
    getActiveSubjects: jest.fn(),
    getPublicTutor: jest.fn(),
    searchPublicTutors: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController, PublicTutorsController],
      providers: [{ provide: TutorsService, useValue: service }],
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
  });

  it('allows unauthenticated search and serializes the complete result-card contract', async () => {
    service.searchPublicTutors.mockResolvedValue([
      {
        description: 'Experienced mathematics tutor.',
        displayName: 'Kru Anan',
        experienceYears: 5,
        grade: 'Grade 10',
        listingId: LISTING_ID,
        nextAvailableAt: new Date('2026-09-12T02:00:00.000Z'),
        pricePerHour: 500,
        ratingAverage: 4,
        reviewCount: 24,
        subject: 'Mathematics',
        tutorId: TUTOR_ID,
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/tutors')
      .query({ grade: 'Grade 10', maxPrice: '500', minimumRating: '4', subject: 'mathematics' })
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        listingId: LISTING_ID,
        nextAvailableAt: '2026-09-12T02:00:00.000Z',
        pricePerHour: 500,
        tutorId: TUTOR_ID,
      }),
    ]);
    expect(service.searchPublicTutors).toHaveBeenCalledWith({
      grade: 'Grade 10',
      maxPrice: 500,
      minimumRating: 4,
      subject: 'mathematics',
    });
  });

  it('returns 400 for malformed numeric filters before invoking the service', async () => {
    await request(app.getHttpServer()).get('/api/v1/tutors').query({ maxPrice: '-1' }).expect(400);

    expect(service.searchPublicTutors).not.toHaveBeenCalled();
  });

  it('returns 400 for unsupported catalog values from the service', async () => {
    service.searchPublicTutors.mockRejectedValue(
      new BadRequestException('subject is not a supported active catalog value'),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/tutors')
      .query({ subject: 'Unknown Subject' })
      .expect(400);

    const body = response.body as unknown as { message: string };
    expect(body.message).toBe('subject is not a supported active catalog value');
  });

  it('supports direct public detail reload and rejects malformed Tutor UUIDs', async () => {
    service.getPublicTutor.mockResolvedValue({
      listings: [],
      tutor: {
        bio: 'Experienced mathematics tutor.',
        displayName: 'Kru Anan',
        experienceYears: 5,
        ratingAverage: null,
        reviewCount: 0,
        tutorId: TUTOR_ID,
        verificationStatus: 'VERIFIED',
      },
    });

    const detailResponse = await request(app.getHttpServer())
      .get(`/api/v1/tutors/${TUTOR_ID}`)
      .expect(200);
    const detailBody = detailResponse.body as unknown as {
      listings: unknown[];
      tutor: { tutorId: string };
    };
    expect(detailBody.tutor.tutorId).toBe(TUTOR_ID);
    expect(detailBody.listings).toEqual([]);
    expect(service.getPublicTutor).toHaveBeenCalledWith(TUTOR_ID);

    await request(app.getHttpServer()).get('/api/v1/tutors/not-a-uuid').expect(400);
    expect(service.getPublicTutor).toHaveBeenCalledTimes(1);
  });

  it('serves both catalogs publicly', async () => {
    service.getActiveSubjects.mockResolvedValue({ items: [] });
    service.getActiveGradeLevels.mockResolvedValue({ items: [] });

    await request(app.getHttpServer()).get('/api/v1/subjects').expect(200, { items: [] });
    await request(app.getHttpServer()).get('/api/v1/grade-levels').expect(200, { items: [] });
  });
});

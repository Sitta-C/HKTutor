import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { Prisma, TutorVerificationStatus } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorRankingPriority, TutorRecommendationTag } from '@modules/tutors/tutor-ranking';
import { TutorsPublicController } from '@modules/tutors/tutors-public.controller';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const NEXT_SLOT = new Date('2026-11-01T02:00:00.000Z');
function matchingObject(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value);
}

describe('S2-T13 named priority and explanation HTTP contract', () => {
  let app: INestApplication<App>;
  const prisma = {
    $queryRaw: jest.fn(),
    availabilitySlot: { findFirst: jest.fn() },
    gradeLevel: { findFirst: jest.fn() },
    subject: { findFirst: jest.fn() },
    teachingListing: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    tutorProfile: { aggregate: jest.fn() },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TutorsPublicController],
      providers: [
        TutorDirectoryService,
        { provide: TutorAvailabilityService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ id: LISTING_ID }]);
    prisma.availabilitySlot.findFirst.mockResolvedValue({ startAtUtc: NEXT_SLOT });
    prisma.teachingListing.aggregate.mockResolvedValue({
      _min: { pricePerHour: new Prisma.Decimal('400.50') },
    });
    prisma.tutorProfile.aggregate.mockResolvedValue({
      _max: { ratingAverage: new Prisma.Decimal('4.8') },
    });
    prisma.teachingListing.count.mockResolvedValue(1);
    prisma.subject.findFirst.mockResolvedValue({ id: 'subject-id' });
    prisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-id' });
    prisma.teachingListing.findMany.mockResolvedValue([
      {
        description: 'Secondary school mathematics lessons.',
        gradeLevel: { name: 'Grade 10' },
        id: LISTING_ID,
        pricePerHour: new Prisma.Decimal('400.50'),
        subject: { name: 'Mathematics' },
        tutorProfile: {
          availabilitySlots: [{ startAtUtc: NEXT_SLOT }],
          displayName: 'Tutor A',
          experienceYears: 3,
          ratingAverage: new Prisma.Decimal('4.8'),
          reviewCount: 5,
          user: { avatarUpdatedAt: null },
          userId: '20000000-0000-4000-8000-000000000001',
          verificationStatus: TutorVerificationStatus.VERIFIED,
        },
      },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    [TutorRankingPriority.LOWEST_PRICE, TutorRecommendationTag.LOWEST_PRICE],
    [TutorRankingPriority.HIGHEST_RATING, TutorRecommendationTag.HIGHEST_RATED],
    [TutorRankingPriority.EARLIEST_AVAILABILITY, TutorRecommendationTag.EARLIEST_AVAILABILITY],
  ])(
    'accepts priority=%s through the real validation pipe and returns truthful tags',
    async (priority, tag) => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/tutors')
        .query({
          grade: 'Grade 10',
          maxPrice: '400.50',
          minimumRating: '4',
          page: '2',
          pageSize: '5',
          priority,
          subject: 'mathematics',
        })
        .expect(200);
      expect(response.body).toMatchObject({
        items: [{ recommendationTags: [TutorRecommendationTag.FITS_BUDGET, tag] }],
        page: 2,
        pageSize: 5,
      });
      expect(prisma.teachingListing.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: matchingObject({
            gradeLevelId: 'grade-id',
            pricePerHour: { lte: 400.5 },
            subjectId: 'subject-id',
          }),
        }),
      );
    },
  );

  it.each(['unknown', '', 'HIGHEST_RATING'])(
    'returns 400 for priority=%p before persistence',
    async (priority) => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/tutors')
        .query({ priority })
        .expect(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
      expect(prisma.teachingListing.findMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it.each([
    { pricePriority: 0 },
    { priceOrder: 'asc' },
    { ratingPriority: 0 },
    { ratingOrder: 'desc' },
    { availabilityPriority: 0 },
    { availabilityOrder: 'asc' },
  ])(
    'rejects contradictory priority and individual settings %p before persistence',
    async (sort) => {
      await request(app.getHttpServer())
        .get('/api/v1/tutors')
        .query({ ...sort, priority: 'lowest_price' })
        .expect(400);
      expect(prisma.teachingListing.findMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it('keeps individual sort callers supported and returns no unsupported explanation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tutors')
      .query({ ratingOrder: 'asc', ratingPriority: 1 })
      .expect(200);
    expect(response.body).toMatchObject({ items: [{ recommendationTags: [] }] });
    expect(prisma.tutorProfile.aggregate).not.toHaveBeenCalled();
  });
});

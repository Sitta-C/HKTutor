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

describe('S2-T13 named priority and explanation HTTP contract', () => {
  let app: INestApplication<App>;
  // S3-T19: search reads raw review totals in one snapshot; 72/15 is a 4.80 average.
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    teachingListing: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(),
    gradeLevel: { findFirst: jest.fn() },
    subject: { findFirst: jest.fn() },
  };
  const statements = (): Prisma.Sql[] =>
    tx.$queryRaw.mock.calls.map(([statement]: [Prisma.Sql]) => statement);
  const isSummary = (statement: Prisma.Sql): boolean => statement.sql.includes('AS "total"');
  const isBest = (statement: Prisma.Sql): boolean =>
    !isSummary(statement) && statement.sql.includes('LIMIT 1');

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
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    );
    tx.$queryRaw.mockImplementation((statement: Prisma.Sql) =>
      Promise.resolve(
        isSummary(statement)
          ? [
              {
                earliestAvailableAt: NEXT_SLOT,
                lowestPrice: new Prisma.Decimal('400.50'),
                total: 1,
              },
            ]
          : isBest(statement)
            ? [{ ratingTotal: BigInt(72), reviewCount: 5 }]
            : [
                {
                  id: LISTING_ID,
                  nextAvailableAt: NEXT_SLOT,
                  ratingTotal: BigInt(72),
                  reviewCount: 5,
                },
              ],
      ),
    );
    prisma.subject.findFirst.mockResolvedValue({ id: 'subject-id' });
    prisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-id' });
    tx.teachingListing.findMany.mockResolvedValue([
      {
        description: 'Secondary school mathematics lessons.',
        gradeLevel: { name: 'Grade 10' },
        id: LISTING_ID,
        pricePerHour: new Prisma.Decimal('400.50'),
        subject: { name: 'Mathematics' },
        tutorProfile: {
          displayName: 'Tutor A',
          experienceYears: 3,
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
        items: [
          {
            ratingAverage: 4.8,
            recommendationTags: [TutorRecommendationTag.FITS_BUDGET, tag],
            reviewCount: 5,
          },
        ],
        page: 2,
        pageSize: 5,
      });
      const summary = statements().find(isSummary);
      expect(summary?.values).toEqual([
        expect.any(Date),
        'subject-id',
        'grade-id',
        '400.50',
        '4.00',
      ]);
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
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('keeps individual sort callers supported and returns no unsupported explanation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tutors')
      .query({ ratingOrder: 'asc', ratingPriority: 1 })
      .expect(200);
    expect(response.body).toMatchObject({ items: [{ recommendationTags: [] }] });
    expect(statements().some(isBest)).toBe(false);
  });
});

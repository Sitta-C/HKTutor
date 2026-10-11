import { Test } from '@nestjs/testing';

import { Prisma, TutorVerificationStatus } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorRankingPriority, TutorRecommendationTag } from '@modules/tutors/tutor-ranking';

const NOW = new Date('2026-10-11T00:00:00.000Z');
const EARLIEST = new Date('2026-10-12T02:00:00.000Z');
function matchingObject(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value);
}
const row = (price = '400.50', rating: string | null = '4.8', start: Date | null = EARLIEST) => ({
  description: 'Mathematics lessons for secondary students.',
  gradeLevel: { name: 'Grade 10' },
  id: '10000000-0000-4000-8000-000000000001',
  pricePerHour: new Prisma.Decimal(price),
  subject: { name: 'Mathematics' },
  tutorProfile: {
    availabilitySlots: start === null ? [] : [{ startAtUtc: start }],
    displayName: 'Tutor A',
    experienceYears: 5,
    ratingAverage: rating === null ? null : new Prisma.Decimal(rating),
    reviewCount: 2,
    user: { avatarUpdatedAt: null },
    userId: '20000000-0000-4000-8000-000000000001',
    verificationStatus: TutorVerificationStatus.VERIFIED,
  },
});

describe('TutorDirectoryService ranking explanations', () => {
  let service: TutorDirectoryService;
  const prisma = {
    $queryRaw: jest.fn(),
    availabilitySlot: { findFirst: jest.fn() },
    gradeLevel: { findFirst: jest.fn() },
    subject: { findFirst: jest.fn() },
    teachingListing: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    tutorProfile: { aggregate: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    prisma.subject.findFirst.mockResolvedValue({ id: 'subject-id' });
    prisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-id' });
    prisma.teachingListing.findMany.mockResolvedValue([row()]);
    prisma.teachingListing.count.mockResolvedValue(20);
    prisma.$queryRaw.mockResolvedValue([{ id: row().id }]);
    const module = await Test.createTestingModule({
      providers: [TutorDirectoryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TutorDirectoryService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('computes lowest price before pagination using all the same public filters', async () => {
    prisma.teachingListing.aggregate.mockResolvedValue({
      _min: { pricePerHour: new Prisma.Decimal('350') },
    });
    const result = await service.searchPublicTutors({
      grade: 'Grade 10',
      maxPrice: 500,
      minimumRating: 4,
      page: 2,
      pageSize: 5,
      priority: TutorRankingPriority.LOWEST_PRICE,
      subject: 'Mathematics',
    });
    expect(result.items[0]?.recommendationTags).toEqual([TutorRecommendationTag.FITS_BUDGET]);
    expect(prisma.teachingListing.aggregate).toHaveBeenCalledWith({
      _min: { pricePerHour: true },
      where: {
        deletedAt: null,
        gradeLevelId: 'grade-id',
        pricePerHour: { lte: 500 },
        publicationStatus: 'PUBLISHED',
        publishedAt: { not: null },
        subjectId: 'subject-id',
        tutorProfile: { ...publicTutorWhere, ratingAverage: { gte: 4 } },
      },
    });
    expect(result.page).toBe(2);
  });

  it('uses the globally highest known matching rating, never the best value on this page', async () => {
    prisma.tutorProfile.aggregate.mockResolvedValue({
      _max: { ratingAverage: new Prisma.Decimal('4.9') },
    });
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.HIGHEST_RATING,
      page: 2,
    });
    expect(result.items[0]?.recommendationTags).toEqual([]);
    expect(prisma.tutorProfile.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: matchingObject({
          ...publicTutorWhere,
          listings: {
            some: matchingObject({ tutorProfile: publicTutorWhere }),
          },
        }),
      }),
    );
  });

  it('marks every tied highest rating and does not turn null ratings into zero', async () => {
    prisma.tutorProfile.aggregate.mockResolvedValue({
      _max: { ratingAverage: new Prisma.Decimal('4.8') },
    });
    prisma.teachingListing.findMany.mockResolvedValue([
      row(),
      row('350', '4.80'),
      row('300', null),
    ]);
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.HIGHEST_RATING,
    });
    expect(result.items.map((item) => item.recommendationTags)).toEqual([
      [TutorRecommendationTag.HIGHEST_RATED],
      [TutorRecommendationTag.HIGHEST_RATED],
      [],
    ]);
  });

  it('gets the earliest explanation from future unreserved slots belonging to matching public tutors', async () => {
    prisma.availabilitySlot.findFirst.mockResolvedValue({ startAtUtc: EARLIEST });
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.EARLIEST_AVAILABILITY,
    });
    expect(result.items[0]?.recommendationTags).toEqual([
      TutorRecommendationTag.EARLIEST_AVAILABILITY,
    ]);
    expect(prisma.availabilitySlot.findFirst).toHaveBeenCalledWith({
      orderBy: [{ startAtUtc: 'asc' }, { id: 'asc' }],
      select: { startAtUtc: true },
      where: {
        bookings: { none: { status: { in: ['PENDING', 'CONFIRMED'] } } },
        deletedAt: null,
        startAtUtc: { gt: NOW },
        tutorProfile: {
          ...publicTutorWhere,
          listings: {
            some: {
              deletedAt: null,
              publicationStatus: 'PUBLISHED',
              publishedAt: { not: null },
              tutorProfile: publicTutorWhere,
            },
          },
        },
      },
    });
  });

  it('does not tag no-slot results when no matching bookable slot exists', async () => {
    prisma.availabilitySlot.findFirst.mockResolvedValue(null);
    prisma.teachingListing.findMany.mockResolvedValue([row('400.5', '4.8', null)]);
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.EARLIEST_AVAILABILITY,
    });
    expect(result.items[0]?.recommendationTags).toEqual([]);
  });

  it('returns an empty result for no matches without inventing best-value tags', async () => {
    prisma.teachingListing.aggregate.mockResolvedValue({ _min: { pricePerHour: null } });
    prisma.teachingListing.findMany.mockResolvedValue([]);
    prisma.teachingListing.count.mockResolvedValue(0);
    await expect(
      service.searchPublicTutors({ priority: TutorRankingPriority.LOWEST_PRICE }),
    ).resolves.toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('does not issue best-value queries when no named priority is requested', async () => {
    const result = await service.searchPublicTutors({ maxPrice: 400.49 });
    expect(result.items[0]?.recommendationTags).toEqual([]);
    expect(prisma.teachingListing.aggregate).not.toHaveBeenCalled();
    expect(prisma.tutorProfile.aggregate).not.toHaveBeenCalled();
    expect(prisma.availabilitySlot.findFirst).not.toHaveBeenCalled();
  });
});

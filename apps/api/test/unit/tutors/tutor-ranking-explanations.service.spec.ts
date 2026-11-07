import { Test } from '@nestjs/testing';

import { Prisma, TutorVerificationStatus } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorRankingPriority, TutorRecommendationTag } from '@modules/tutors/tutor-ranking';
import { RATING_KEY, searchConditions } from '@modules/tutors/tutor-search-query';

const NOW = new Date('2026-10-11T00:00:00.000Z');
const EARLIEST = new Date('2026-10-12T02:00:00.000Z');
const LISTING_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
] as const;

interface PageRow {
  id: string;
  ratingTotal: bigint;
  reviewCount: number;
  nextAvailableAt: Date | null;
}

const squash = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
const pageRow = (
  id: string,
  ratingTotal: number,
  reviewCount: number,
  nextAvailableAt: Date | null = EARLIEST,
): PageRow => ({ id, ratingTotal: BigInt(ratingTotal), reviewCount, nextAvailableAt });
const listing = (id: string, price = '400.50') => ({
  description: 'Mathematics lessons for secondary students.',
  gradeLevel: { name: 'Grade 10' },
  id,
  pricePerHour: new Prisma.Decimal(price),
  subject: { name: 'Mathematics' },
  tutorProfile: {
    displayName: 'Tutor A',
    experienceYears: 5,
    user: { avatarUpdatedAt: null },
    userId: '20000000-0000-4000-8000-000000000001',
    verificationStatus: TutorVerificationStatus.VERIFIED,
  },
});

describe('TutorDirectoryService ranking explanations', () => {
  let service: TutorDirectoryService;
  const data = {
    best: [] as { ratingTotal: bigint; reviewCount: number }[],
    rows: [] as PageRow[],
    summary: {
      earliestAvailableAt: null as Date | null,
      lowestPrice: null as Prisma.Decimal | null,
      total: 0,
    },
  };
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
  const statement = (kind: 'summary' | 'best' | 'page'): Prisma.Sql | undefined =>
    statements().find((item) => kindOf(item) === kind);
  function kindOf(item: Prisma.Sql): 'summary' | 'best' | 'page' {
    if (item.sql.includes('AS "total"')) return 'summary';
    return item.sql.includes('LIMIT 1') ? 'best' : 'page';
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    data.best = [];
    data.rows = [pageRow(LISTING_IDS[0], 72, 5)];
    data.summary = { earliestAvailableAt: EARLIEST, lowestPrice: null, total: 20 };
    prisma.subject.findFirst.mockResolvedValue({ id: 'subject-id' });
    prisma.gradeLevel.findFirst.mockResolvedValue({ id: 'grade-id' });
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
    );
    tx.$queryRaw.mockImplementation((item: Prisma.Sql) => {
      const kind = kindOf(item);
      return Promise.resolve(
        kind === 'summary' ? [data.summary] : kind === 'best' ? data.best : data.rows,
      );
    });
    tx.teachingListing.findMany.mockImplementation(() =>
      Promise.resolve(data.rows.map(({ id }) => listing(id))),
    );
    const module = await Test.createTestingModule({
      providers: [TutorDirectoryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TutorDirectoryService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('computes lowest price before pagination using all the same public filters', async () => {
    data.summary.lowestPrice = new Prisma.Decimal('350');
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
    const conditions = searchConditions({
      gradeLevelId: 'grade-id',
      maxPrice: 500,
      minimumRating: 4,
      subjectId: 'subject-id',
    });
    const summary = statement('summary');
    expect(squash(summary?.sql ?? '')).toContain(`MIN(tl."pricePerHour") AS "lowestPrice"`);
    expect(squash(summary?.sql ?? '')).toMatch(
      new RegExp(`WHERE ${escapeRegExp(squash(conditions.sql))}$`),
    );
    expect(summary?.values).toEqual([NOW, ...conditions.values]);
    expect(summary?.sql).not.toMatch(/OFFSET|LIMIT/);
    expect(result.page).toBe(2);
  });

  it('uses the globally highest matching rating, never the best value on this page', async () => {
    data.best = [{ ratingTotal: BigInt(147), reviewCount: 10 }];
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.HIGHEST_RATING,
      page: 2,
    });

    expect(result.items[0]?.recommendationTags).toEqual([]);
    const best = squash(statement('best')?.sql ?? '');
    expect(best).toContain(`${squash(searchConditions({}).sql)} AND rt."reviewCount" > 0`);
    expect(best).toContain(`ORDER BY ${squash(RATING_KEY.sql)} DESC LIMIT 1`);
    expect(best).not.toContain('OFFSET');
  });

  it('marks every exactly tied raw rating, not ratings that only round alike, and never null', async () => {
    data.best = [{ ratingTotal: BigInt(62), reviewCount: 5 }];
    data.rows = [
      pageRow(LISTING_IDS[0], 62, 5),
      pageRow(LISTING_IDS[1], 124, 10),
      pageRow(LISTING_IDS[2], 99, 8),
      pageRow(LISTING_IDS[3], 0, 0),
    ];
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.HIGHEST_RATING,
    });

    // 62/15 and 124/30 are the same 4.1333...; 99/24 is 4.125. All three display as 4.13.
    expect(result.items.map((item) => [item.ratingAverage, item.recommendationTags])).toEqual([
      [4.13, [TutorRecommendationTag.HIGHEST_RATED]],
      [4.13, [TutorRecommendationTag.HIGHEST_RATED]],
      [4.13, []],
      [null, []],
    ]);
  });

  it('gets the earliest explanation from the matching set summary', async () => {
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.EARLIEST_AVAILABILITY,
    });

    expect(result.items[0]?.recommendationTags).toEqual([
      TutorRecommendationTag.EARLIEST_AVAILABILITY,
    ]);
    expect(squash(statement('summary')?.sql ?? '')).toContain(
      'MIN(na."nextAvailableAt") AS "earliestAvailableAt"',
    );
  });

  it('does not tag no-slot results when no matching bookable slot exists', async () => {
    data.summary.earliestAvailableAt = null;
    data.rows = [pageRow(LISTING_IDS[0], 72, 5, null)];
    const result = await service.searchPublicTutors({
      priority: TutorRankingPriority.EARLIEST_AVAILABILITY,
    });

    expect(result.items[0]?.recommendationTags).toEqual([]);
  });

  it('returns an empty result for no matches without inventing best-value tags', async () => {
    data.rows = [];
    data.summary = { earliestAvailableAt: null, lowestPrice: null, total: 0 };

    await expect(
      service.searchPublicTutors({ priority: TutorRankingPriority.LOWEST_PRICE }),
    ).resolves.toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(tx.teachingListing.findMany).not.toHaveBeenCalled();
  });

  it('does not issue the best-rating statement or tags when no named priority is requested', async () => {
    data.summary.lowestPrice = new Prisma.Decimal('400.50');
    const result = await service.searchPublicTutors({ maxPrice: 400.49 });

    expect(result.items[0]?.recommendationTags).toEqual([]);
    expect(statement('best')).toBeUndefined();
    expect(statements().map(kindOf)).toEqual(['summary', 'page']);
  });
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

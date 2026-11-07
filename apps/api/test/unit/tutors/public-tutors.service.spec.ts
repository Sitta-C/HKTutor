import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { TutorDirectoryService as TutorsService } from '@modules/tutors/tutor-directory.service';
import { resolveTutorRankingQuery, TutorRankingPriority } from '@modules/tutors/tutor-ranking';
import { searchConditions, searchOrderBy } from '@modules/tutors/tutor-search-query';

import type { PrismaService } from '@infrastructure/database/prisma.service';
import type { TutorSearchQueryDto } from '@modules/tutors/tutors.dto';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const TUTOR_ID_2 = '20000000-0000-4000-8000-000000000002';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const LISTING_ID_2 = '10000000-0000-4000-8000-000000000002';
const SUBJECT_ID = '30000000-0000-4000-8000-000000000001';
const GRADE_ID = '40000000-0000-4000-8000-000000000001';
const NEXT_SLOT = new Date('2026-09-12T02:00:00.000Z');

const subject = { active: true, code: 'MATH', id: SUBJECT_ID, name: 'Mathematics' };
const gradeLevel = {
  active: true,
  code: 'G10',
  id: GRADE_ID,
  name: 'Grade 10',
  sortOrder: 10,
};

const decimal = (value: number) => ({ toNumber: () => value });
const squash = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

interface PageRow {
  id: string;
  ratingTotal: bigint;
  reviewCount: number;
  nextAvailableAt: Date | null;
}

const pageRow = (
  id: string,
  ratingTotal: number,
  reviewCount: number,
  nextAvailableAt: Date | null = NEXT_SLOT,
): PageRow => ({ id, ratingTotal: BigInt(ratingTotal), reviewCount, nextAvailableAt });

type StatementKind = 'summary' | 'best' | 'page';

function kindOf(statement: Prisma.Sql): StatementKind {
  if (statement.sql.includes('AS "total"')) return 'summary';
  return statement.sql.includes('LIMIT 1') ? 'best' : 'page';
}

// S3-T19: search runs inside one snapshot transaction; listing details still come from the ORM.
function createPrisma() {
  const data = {
    best: [] as { ratingTotal: bigint; reviewCount: number }[],
    listings: undefined as unknown[] | undefined,
    rows: [] as PageRow[],
    total: 0,
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn((statement: Prisma.Sql) => {
      const kind = kindOf(statement);
      return Promise.resolve(
        kind === 'summary'
          ? [{ earliestAvailableAt: null, lowestPrice: null, total: data.total }]
          : kind === 'best'
            ? data.best
            : data.rows,
      );
    }),
    teachingListing: {
      findMany: jest.fn(() =>
        Promise.resolve(data.listings ?? data.rows.map(({ id }) => publicSearchListing({ id }))),
      ),
    },
  };
  return {
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    data,
    gradeLevel: { findFirst: jest.fn(), findMany: jest.fn() },
    subject: { findFirst: jest.fn(), findMany: jest.fn() },
    tutorProfile: { findFirst: jest.fn() },
    tx,
  };
}

function statementOf(prisma: ReturnType<typeof createPrisma>, kind: StatementKind): Prisma.Sql {
  const calls = prisma.tx.$queryRaw.mock.calls.map(([statement]) => statement);
  const found = calls.reverse().find((statement) => kindOf(statement) === kind);
  if (!found) throw new Error(`Missing ${kind} statement`);
  return found;
}

function publicSearchListing(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Experienced mathematics tutor.',
    gradeLevel: { name: gradeLevel.name },
    id: LISTING_ID,
    pricePerHour: new Prisma.Decimal(500),
    subject: { name: subject.name },
    tutorProfile: {
      user: { avatarUpdatedAt: null },
      displayName: 'Kru Anan',
      experienceYears: 5,
      userId: TUTOR_ID,
      verificationStatus: 'VERIFIED',
    },
    ...overrides,
  };
}

function publicTutor(overrides: Record<string, unknown> = {}) {
  return {
    user: { avatarUpdatedAt: null },
    bio: 'Experienced mathematics tutor.',
    displayName: 'Kru Anan',
    experienceYears: 5,
    listings: [
      {
        description: 'Experienced mathematics tutor.',
        gradeLevel: { name: gradeLevel.name },
        id: LISTING_ID,
        pricePerHour: decimal(500),
        subject: { name: subject.name },
      },
    ],
    ratingAverage: decimal(4),
    reviewCount: 24,
    userId: TUTOR_ID,
    verificationStatus: 'VERIFIED',
    ...overrides,
  };
}

function expectNoPrivateFields(value: unknown): void {
  const forbidden = new Set([
    'avatarObjectPath',
    'avatarMimeType',
    'avatarSizeBytes',
    'accountStatus',
    'consentAcceptedAt',
    'deletedAt',
    'documentUrl',
    'email',
    'firstName',
    'lastName',
    'nickname',
    'passwordHash',
    'phone',
    'policyVersion',
    'verificationDocumentUrl',
  ]);

  if (Array.isArray(value)) {
    value.forEach(expectNoPrivateFields);
  } else if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, nested]) => {
      expect(forbidden.has(key)).toBe(false);
      expectNoPrivateFields(nested);
    });
  }
}

describe('TutorDirectoryService', () => {
  it('returns only public fields, displaying the rating from Review totals', async () => {
    const prisma = createPrisma();
    prisma.data.rows = [pageRow(LISTING_ID, 26, 2)];
    prisma.data.total = 1;
    const service = new TutorsService(prisma as unknown as PrismaService);

    const result = await service.searchPublicTutors({});
    expect(result).toEqual({
      items: [
        {
          avatarUpdatedAt: null,
          description: 'Experienced mathematics tutor.',
          displayName: 'Kru Anan',
          experienceYears: 5,
          grade: 'Grade 10',
          listingId: LISTING_ID,
          nextAvailableAt: NEXT_SLOT,
          pricePerHour: 500,
          ratingAverage: 4.33,
          recommendationTags: [],
          reviewCount: 2,
          subject: 'Mathematics',
          tutorId: TUTOR_ID,
          verificationStatus: 'VERIFIED',
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(result.items[0]?.listingId).not.toBe(result.items[0]?.tutorId);
    expectNoPrivateFields(result);

    const [args] = prisma.tx.teachingListing.findMany.mock.calls[0] as unknown as [
      { select: { tutorProfile: { select: Record<string, unknown> } }; where: unknown },
    ];
    expect(args.where).toEqual({ id: { in: [LISTING_ID] } });
    expect(Object.keys(args.select.tutorProfile.select).sort()).toEqual([
      'displayName',
      'experienceYears',
      'user',
      'userId',
      'verificationStatus',
    ]);
  });

  it('returns a null rating and zero count for a tutor without reviews, rounding others HALF_UP', async () => {
    const prisma = createPrisma();
    prisma.data.rows = [pageRow(LISTING_ID, 99, 8), pageRow(LISTING_ID_2, 0, 0, null)];
    const service = new TutorsService(prisma as unknown as PrismaService);

    const result = await service.searchPublicTutors({});
    expect(
      result.items.map(({ ratingAverage, reviewCount }) => [ratingAverage, reviewCount]),
    ).toEqual([
      [4.13, 8],
      [null, 0],
    ]);
    expect(result.items[1]?.nextAvailableAt).toBeNull();
  });

  it('reads the summary, best rating and page in one read-only repeatable-read snapshot', async () => {
    const prisma = createPrisma();
    prisma.data.rows = [pageRow(LISTING_ID, 26, 2)];
    const service = new TutorsService(prisma as unknown as PrismaService);

    await service.searchPublicTutors({ priority: TutorRankingPriority.HIGHEST_RATING });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    const [readOnly] = prisma.tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray];
    expect(readOnly.join('')).toBe('SET TRANSACTION READ ONLY');
    const executeOrder = prisma.tx.$executeRaw.mock.invocationCallOrder[0] ?? Infinity;
    expect(
      prisma.tx.$queryRaw.mock.invocationCallOrder.every((order) => order > executeOrder),
    ).toBe(true);
    expect(prisma.tx.$queryRaw.mock.calls.map(([statement]) => kindOf(statement))).toEqual([
      'summary',
      'best',
      'page',
    ]);
    expect(prisma.tx.teachingListing.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(...prisma.tx.$queryRaw.mock.invocationCallOrder),
    );
  });

  it.each<[TutorSearchQueryDto, Parameters<typeof searchConditions>[0]]>([
    [{}, {}],
    [{ subject: 'Mathematics' }, { subjectId: SUBJECT_ID }],
    [{ grade: 'Grade 10' }, { gradeLevelId: GRADE_ID }],
    [{ maxPrice: 500 }, { maxPrice: 500 }],
    [{ minimumRating: 4.33 }, { minimumRating: 4.33 }],
    [
      { grade: 'Grade 10', maxPrice: 500, minimumRating: 4, subject: 'Mathematics' },
      { gradeLevelId: GRADE_ID, maxPrice: 500, minimumRating: 4, subjectId: SUBJECT_ID },
    ],
  ])(
    'applies filters %p to both the summary and the page with AND semantics',
    async (query, filters) => {
      const prisma = createPrisma();
      prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
      prisma.gradeLevel.findFirst.mockResolvedValue({ id: GRADE_ID });
      const service = new TutorsService(prisma as unknown as PrismaService);

      await service.searchPublicTutors(query);

      const conditions = searchConditions(filters);
      for (const kind of ['summary', 'page'] as const) {
        const statement = statementOf(prisma, kind);
        expect(squash(statement.sql)).toContain(`WHERE ${squash(conditions.sql)}`);
        expect(statement.values.slice(1, 1 + conditions.values.length)).toEqual(conditions.values);
      }
    },
  );

  it('keeps tutors without reviews out of minimum-rating searches but allows them otherwise', async () => {
    const prisma = createPrisma();
    const service = new TutorsService(prisma as unknown as PrismaService);

    await service.searchPublicTutors({ minimumRating: 4 });
    expect(squash(statementOf(prisma, 'page').sql)).toContain('rt."reviewCount" > 0');

    await service.searchPublicTutors({});
    expect(squash(statementOf(prisma, 'page').sql)).not.toContain('rt."reviewCount" > 0');
  });

  it('uses exact case-insensitive catalog matches and rejects unsupported values', async () => {
    const prisma = createPrisma();
    prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.searchPublicTutors({ subject: 'mathematics' })).resolves.toMatchObject({
      items: [],
      total: 0,
      totalPages: 0,
    });
    expect(prisma.subject.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { active: true, name: { equals: 'mathematics', mode: 'insensitive' } },
    });

    prisma.subject.findFirst.mockResolvedValue(null);
    await expect(service.searchPublicTutors({ subject: 'Math' })).rejects.toThrow(
      new BadRequestException('subject is not a supported active catalog value'),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not turn a partial subject into a match and rejects unsupported grades', async () => {
    const prisma = createPrisma();
    prisma.subject.findFirst.mockResolvedValue(null);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.searchPublicTutors({ subject: 'Math' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();

    prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
    prisma.gradeLevel.findFirst.mockResolvedValue(null);
    await expect(service.searchPublicTutors({ grade: 'Grade 1' })).rejects.toThrow(
      new BadRequestException('grade is not a supported active catalog value'),
    );
  });

  it('applies page bounds to the page only and returns pagination metadata from the summary', async () => {
    const prisma = createPrisma();
    prisma.data.total = 12;
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.searchPublicTutors({ page: 3, pageSize: 5 })).resolves.toEqual({
      items: [],
      page: 3,
      pageSize: 5,
      total: 12,
      totalPages: 3,
    });
    const page = statementOf(prisma, 'page');
    expect(squash(page.sql)).toMatch(/OFFSET \? LIMIT \?$/);
    expect(page.values.slice(-2)).toEqual([10, 5]);
    expect(statementOf(prisma, 'summary').sql).not.toMatch(/OFFSET|LIMIT/);
    expect(prisma.tx.teachingListing.findMany).not.toHaveBeenCalled();
  });

  it.each<TutorSearchQueryDto>([
    {},
    { ratingPriority: 1 },
    { ratingOrder: 'asc', ratingPriority: 1 },
    { pricePriority: 1 },
    { priceOrder: 'desc', pricePriority: 1 },
    { priceOrder: 'desc', pricePriority: 2, ratingOrder: 'asc', ratingPriority: 1 },
    { availabilityOrder: 'desc', availabilityPriority: 1 },
    { availabilityPriority: 1, pricePriority: 2 },
    { priority: TutorRankingPriority.LOWEST_PRICE },
    { priority: TutorRankingPriority.HIGHEST_RATING },
    { priority: TutorRankingPriority.EARLIEST_AVAILABILITY },
  ])('orders the page for %p with the shared raw-rating ORDER BY', async (query) => {
    const prisma = createPrisma();
    const service = new TutorsService(prisma as unknown as PrismaService);

    await service.searchPublicTutors(query);

    expect(squash(statementOf(prisma, 'page').sql)).toContain(
      `ORDER BY ${squash(searchOrderBy(resolveTutorRankingQuery(query)).sql)} OFFSET`,
    );
  });

  it('preserves the exact order of the page rows whatever order the ORM returns', async () => {
    const prisma = createPrisma();
    prisma.data.rows = [pageRow(LISTING_ID_2, 15, 1), pageRow(LISTING_ID, 26, 2)];
    prisma.data.listings = [
      publicSearchListing(),
      publicSearchListing({
        id: LISTING_ID_2,
        pricePerHour: new Prisma.Decimal(300),
        tutorProfile: { ...publicSearchListing().tutorProfile, userId: TUTOR_ID_2 },
      }),
    ];
    prisma.data.total = 2;
    const service = new TutorsService(prisma as unknown as PrismaService);

    const result = await service.searchPublicTutors({ ratingPriority: 1 });

    expect(result.items.map(({ listingId, ratingAverage }) => [listingId, ratingAverage])).toEqual([
      [LISTING_ID_2, 5],
      [LISTING_ID, 4.33],
    ]);
  });

  it('propagates database failures from the search snapshot unchanged', async () => {
    const prisma = createPrisma();
    const failure = new Prisma.PrismaClientKnownRequestError('Search failed', {
      clientVersion: '7.10.0',
      code: 'P2010',
    });
    prisma.$transaction.mockRejectedValueOnce(failure);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.searchPublicTutors({})).rejects.toBe(failure);
  });

  it('returns a public Tutor detail with zero or more published listings only', async () => {
    const prisma = createPrisma();
    prisma.tutorProfile.findFirst.mockResolvedValue(publicTutor({ listings: [] }));
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getPublicTutor(TUTOR_ID)).resolves.toEqual({
      listings: [],
      tutor: {
        avatarUpdatedAt: null,
        bio: 'Experienced mathematics tutor.',
        displayName: 'Kru Anan',
        experienceYears: 5,
        ratingAverage: 4,
        reviewCount: 24,
        tutorId: TUTOR_ID,
        verificationStatus: 'VERIFIED',
      },
    });
    expect(prisma.tutorProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: TUTOR_ID,
          verificationStatus: 'VERIFIED',
          user: { accountStatus: 'ACTIVE', deletedAt: null, role: 'TUTOR' },
        }) as object,
      }),
    );
    expectNoPrivateFields(await service.getPublicTutor(TUTOR_ID));
  });

  it('returns null rating and zero review count for a Tutor with no reviews', async () => {
    const prisma = createPrisma();
    prisma.tutorProfile.findFirst.mockResolvedValue(
      publicTutor({ listings: [], ratingAverage: null, reviewCount: 0 }),
    );
    const service = new TutorsService(prisma as unknown as PrismaService);

    const detail = await service.getPublicTutor(TUTOR_ID);
    expect(detail.tutor.ratingAverage).toBeNull();
    expect(detail.tutor.reviewCount).toBe(0);
  });

  it('reads the Tutor detail fresh on every call, never from a stale prior response', async () => {
    const prisma = createPrisma();
    const service = new TutorsService(prisma as unknown as PrismaService);

    prisma.tutorProfile.findFirst.mockResolvedValueOnce(
      publicTutor({ listings: [], ratingAverage: null, reviewCount: 0 }),
    );
    const beforeReview = await service.getPublicTutor(TUTOR_ID);
    expect(beforeReview.tutor.reviewCount).toBe(0);

    // A review landing between calls (the same tutorProfile.ratingAverage/reviewCount columns
    // ReviewsService.create updates) must be visible on the very next read; nothing in this
    // service may cache the prior response.
    prisma.tutorProfile.findFirst.mockResolvedValueOnce(
      publicTutor({ listings: [], ratingAverage: decimal(4.33), reviewCount: 1 }),
    );
    const afterReview = await service.getPublicTutor(TUTOR_ID);
    expect(afterReview.tutor.ratingAverage).toBe(4.33);
    expect(afterReview.tutor.reviewCount).toBe(1);
    expect(prisma.tutorProfile.findFirst).toHaveBeenCalledTimes(2);
  });

  it('reports the same rating and review count on the detail route as the search route', async () => {
    const prisma = createPrisma();
    const service = new TutorsService(prisma as unknown as PrismaService);

    // Search reads 5/4/5 and 4/4/4 from Review rows; the detail route reads the S3-T17 cache,
    // which ReviewsService keeps at the same HALF_UP value in the review transaction.
    prisma.data.rows = [pageRow(LISTING_ID, 26, 2)];
    prisma.tutorProfile.findFirst.mockResolvedValue(
      publicTutor({ ratingAverage: decimal(4.33), reviewCount: 2 }),
    );

    const [searchResult, detailResult] = await Promise.all([
      service.searchPublicTutors({}),
      service.getPublicTutor(TUTOR_ID),
    ]);

    expect(searchResult.items[0]?.ratingAverage).toBe(detailResult.tutor.ratingAverage);
    expect(searchResult.items[0]?.reviewCount).toBe(detailResult.tutor.reviewCount);
  });

  it('does not expose an unavailable Tutor', async () => {
    const prisma = createPrisma();
    prisma.tutorProfile.findFirst.mockResolvedValue(null);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getPublicTutor(TUTOR_ID)).rejects.toThrow(
      new NotFoundException('Tutor not found'),
    );
  });

  it.each(['UNVERIFIED', 'PENDING', 'REJECTED'])(
    'hides an unexpected %s tutor instead of exposing it publicly',
    async (verificationStatus) => {
      const prisma = createPrisma();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      prisma.tutorProfile.findFirst.mockResolvedValue(publicTutor({ verificationStatus }));
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.getPublicTutor(TUTOR_ID)).rejects.toThrow(
        new NotFoundException('Tutor not found'),
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(TUTOR_ID));
    },
  );

  it.each(['UNVERIFIED', 'PENDING', 'REJECTED'])(
    'skips an unexpected %s tutor without failing the complete search',
    async (verificationStatus) => {
      const prisma = createPrisma();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const unavailable = publicSearchListing({ id: LISTING_ID_2 });
      unavailable.tutorProfile.verificationStatus = verificationStatus;
      prisma.data.rows = [pageRow(LISTING_ID_2, 26, 2), pageRow(LISTING_ID, 26, 2)];
      prisma.data.listings = [unavailable, publicSearchListing()];
      const service = new TutorsService(prisma as unknown as PrismaService);

      const result = await service.searchPublicTutors({});
      expect(result.items.map((item) => item.listingId)).toEqual([LISTING_ID]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(LISTING_ID_2));
    },
  );

  it('returns active catalogs in deterministic order and preserves empty results', async () => {
    const prisma = createPrisma();
    prisma.subject.findMany.mockResolvedValue([subject]);
    prisma.gradeLevel.findMany.mockResolvedValue([gradeLevel]);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getActiveSubjects()).resolves.toEqual({ items: [subject] });
    await expect(service.getActiveGradeLevels()).resolves.toEqual({ items: [gradeLevel] });
    expect(prisma.subject.findMany).toHaveBeenCalledWith({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { active: true, code: true, id: true, name: true },
      where: { active: true },
    });
    expect(prisma.gradeLevel.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { active: true, code: true, id: true, name: true, sortOrder: true },
      where: { active: true },
    });

    prisma.subject.findMany.mockResolvedValue([]);
    prisma.gradeLevel.findMany.mockResolvedValue([]);
    await expect(service.getActiveSubjects()).resolves.toEqual({ items: [] });
    await expect(service.getActiveGradeLevels()).resolves.toEqual({ items: [] });
  });

  it('maps catalog database outages to 503 without hiding unknown errors', async () => {
    const prisma = createPrisma();
    prisma.subject.findMany.mockRejectedValue(
      Object.assign(new Error('database down'), { code: 'P1001' }),
    );
    prisma.gradeLevel.findMany.mockRejectedValue(new Error('programming failure'));
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getActiveSubjects()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.getActiveGradeLevels()).rejects.toThrow('programming failure');
  });
});

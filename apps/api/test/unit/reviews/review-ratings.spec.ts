import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  reconcileTutorReviewRatings,
  tutorReviewDisplayAverage,
} from '@modules/reviews/review-ratings';

const TUTOR_ID = '50000000-0000-4000-8000-000000000001';
const OTHER_TUTOR_ID = '50000000-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-11-06T00:00:00.000Z');

describe('review display average', () => {
  it.each([
    ['26', 2, '4.33'],
    ['0', 0, null],
    ['3', 1, '1'],
    ['15', 1, '5'],
    // Exact 4.125 boundary: HALF_UP gives 4.13, independently of global Decimal settings.
    ['99', 8, '4.13'],
  ])('rounds raw total %s over %s reviews only at display', (sum, count, expected) => {
    const rating = tutorReviewDisplayAverage({
      dimensionTotal: new Prisma.Decimal(sum),
      latestReviewAt: count === 0 ? null : CREATED_AT,
      reviewCount: count,
    });
    expect(rating?.toString() ?? null).toBe(expected);
  });
});

describe('review rating reconciliation', () => {
  const db = {
    $queryRaw: jest.fn(),
    review: { aggregate: jest.fn() },
    tutorProfile: { findMany: jest.fn(), update: jest.fn() },
  };
  const transaction = jest.fn();
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.resetAllMocks();
    transaction.mockImplementation((run: (tx: typeof db) => Promise<boolean>) => run(db));
    db.$queryRaw.mockResolvedValue([{ userId: TUTOR_ID }]);
    db.tutorProfile.findMany.mockResolvedValueOnce([{ userId: TUTOR_ID }]).mockResolvedValue([]);
    db.review.aggregate.mockResolvedValue({
      _count: 2,
      _max: { createdAt: CREATED_AT },
      _sum: { clarity: 9, punctuality: 8, preparation: 9 },
    });
    const module = await Test.createTestingModule({
      providers: [{ provide: PrismaService, useValue: { ...db, $transaction: transaction } }],
    }).compile();
    prisma = module.get(PrismaService);
  });

  it('locks each tutor before aggregating and writes only rating-cache fields', async () => {
    const order: string[] = [];
    db.$queryRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve([{ userId: TUTOR_ID }]);
    });
    db.review.aggregate.mockImplementation(() => {
      order.push('aggregate');
      return Promise.resolve({
        _count: 2,
        _max: { createdAt: CREATED_AT },
        _sum: { clarity: 9, punctuality: 8, preparation: 9 },
      });
    });
    expect(await reconcileTutorReviewRatings(prisma)).toBe(1);
    expect(order).toEqual(['lock', 'aggregate']);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(db.review.aggregate).toHaveBeenCalledWith({
      _count: true,
      _max: { createdAt: true },
      _sum: { clarity: true, preparation: true, punctuality: true },
      where: { tutorProfileId: TUTOR_ID },
    });
    expect(db.tutorProfile.update).toHaveBeenCalledWith({
      data: {
        ratingAverage: new Prisma.Decimal('4.33'),
        reviewCount: 2,
        ratingUpdatedAt: CREATED_AT,
      },
      where: { userId: TUTOR_ID },
    });
  });

  it('clears fabricated caches for a tutor with no reviews', async () => {
    db.review.aggregate.mockResolvedValue({
      _count: 0,
      _max: { createdAt: null },
      _sum: { clarity: null, preparation: null, punctuality: null },
    });
    await reconcileTutorReviewRatings(prisma);
    expect(db.tutorProfile.update).toHaveBeenCalledWith({
      data: { ratingAverage: null, reviewCount: 0, ratingUpdatedAt: null },
      where: { userId: TUTOR_ID },
    });
  });

  it('continues by ID without skipping the next batch and tolerates a deleted tutor', async () => {
    db.tutorProfile.findMany.mockReset();
    db.tutorProfile.findMany
      .mockResolvedValueOnce([{ userId: TUTOR_ID }])
      .mockResolvedValueOnce([{ userId: OTHER_TUTOR_ID }])
      .mockResolvedValueOnce([]);
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ userId: OTHER_TUTOR_ID }]);
    expect(await reconcileTutorReviewRatings(prisma)).toBe(1);
    expect(db.tutorProfile.update).toHaveBeenCalledTimes(1);
    expect(db.tutorProfile.findMany).toHaveBeenNthCalledWith(2, {
      select: { userId: true },
      orderBy: { userId: 'asc' },
      take: 100,
      where: { userId: { gt: TUTOR_ID } },
    });
  });

  it('propagates a failed cache write so the caller cannot report successful reconciliation', async () => {
    const failure = new Error('database unavailable');
    db.tutorProfile.update.mockRejectedValue(failure);
    await expect(reconcileTutorReviewRatings(prisma)).rejects.toBe(failure);
  });
});

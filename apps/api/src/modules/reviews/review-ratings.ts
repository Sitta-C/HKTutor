import { Prisma } from '@generated/prisma/client';

import type { PrismaClient } from '@generated/prisma/client';

export interface TutorReviewTotals {
  dimensionTotal: Prisma.Decimal;
  reviewCount: number;
  latestReviewAt: Date | null;
}

/** Keep the numerator and count unrounded so consumers can compare raw review aggregates. */
export async function readTutorReviewTotals(
  tx: Prisma.TransactionClient,
  tutorProfileId: string,
): Promise<TutorReviewTotals> {
  const aggregate = await tx.review.aggregate({
    _count: true,
    _max: { createdAt: true },
    _sum: { clarity: true, preparation: true, punctuality: true },
    where: { tutorProfileId },
  });

  return {
    dimensionTotal: new Prisma.Decimal(aggregate._sum.clarity ?? 0)
      .plus(aggregate._sum.punctuality ?? 0)
      .plus(aggregate._sum.preparation ?? 0),
    reviewCount: aggregate._count,
    latestReviewAt: aggregate._max.createdAt,
  };
}

export function tutorReviewDisplayAverage(totals: TutorReviewTotals): Prisma.Decimal | null {
  if (totals.reviewCount === 0) {
    return null;
  }
  return totals.dimensionTotal
    .dividedBy(new Prisma.Decimal(totals.reviewCount).times(3))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** The caller must lock the tutor row before inserting reviews or rebuilding this cache. */
export async function refreshLockedTutorReviewRating(
  tx: Prisma.TransactionClient,
  tutorProfileId: string,
): Promise<void> {
  const totals = await readTutorReviewTotals(tx, tutorProfileId);
  await tx.tutorProfile.update({
    data: {
      ratingAverage: tutorReviewDisplayAverage(totals),
      reviewCount: totals.reviewCount,
      ratingUpdatedAt: totals.latestReviewAt,
    },
    where: { userId: tutorProfileId },
  });
}

/** Rebuild existing caches in bounded batches; each tutor commits atomically with review writers. */
export async function reconcileTutorReviewRatings(prisma: PrismaClient): Promise<number> {
  let cursor: string | undefined;
  let reconciled = 0;

  while (true) {
    const tutors = await prisma.tutorProfile.findMany({
      select: { userId: true },
      orderBy: { userId: 'asc' },
      take: 100,
      ...(cursor === undefined ? {} : { where: { userId: { gt: cursor } } }),
    });
    if (tutors.length === 0) {
      return reconciled;
    }

    for (const tutor of tutors) {
      const refreshed = await prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ userId: string }[]>`
            SELECT "userId" FROM "TutorProfile"
            WHERE "userId" = ${tutor.userId}::uuid FOR UPDATE
          `;
          if (locked.length === 0) {
            return false;
          }
          await refreshLockedTutorReviewRating(tx, tutor.userId);
          return true;
        },
        // A review committed while waiting for the row lock must be visible to the aggregate.
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      if (refreshed) {
        reconciled += 1;
      }
      cursor = tutor.userId;
    }
  }
}

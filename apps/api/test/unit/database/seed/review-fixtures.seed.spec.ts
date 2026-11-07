import { AttendanceStatus, BookingStatus, PaymentStatus, Prisma } from '@generated/prisma/client';
import {
  REVIEW_FIXTURES,
  seedReviewFixtures,
} from '@infrastructure/database/seed/review-fixtures.seed';

import type { SeedTransactionClient } from '@infrastructure/database/seed/seed-client';

const STUDENT_ID = 'student-id';
const MALI_ID = '20000000-0000-4000-8000-000000000001';
const KIET_ID = '20000000-0000-4000-8000-000000000002';
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

type ScoreSums = { clarity: number; punctuality: number; preparation: number };

function createClient() {
  const calls: string[] = [];
  const stored = new Map<string, { count: number; sums: ScoreSums; latest: Date }>();
  const record =
    (name: string) =>
    (args: { create: { id: string } }): Promise<{ id: string }> => {
      calls.push(`${name}:${args.create.id}`);
      return Promise.resolve({ id: args.create.id });
    };
  const reviewUpsert = jest.fn(
    (args: {
      create: ScoreSums & { id: string; tutorProfileId: string; createdAt: Date };
    }): Promise<{ id: string }> => {
      const { clarity, createdAt, preparation, punctuality, tutorProfileId } = args.create;
      const current = stored.get(tutorProfileId) ?? {
        count: 0,
        latest: createdAt,
        sums: { clarity: 0, preparation: 0, punctuality: 0 },
      };
      stored.set(tutorProfileId, {
        count: current.count + 1,
        latest: createdAt > current.latest ? createdAt : current.latest,
        sums: {
          clarity: current.sums.clarity + clarity,
          preparation: current.sums.preparation + preparation,
          punctuality: current.sums.punctuality + punctuality,
        },
      });
      return record('review')(args);
    },
  );
  const client = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`lock:${strings.join('?').includes('FOR UPDATE') ? String(values[0]) : '?'}`);
      return Promise.resolve([]);
    }),
    availabilitySlot: { upsert: jest.fn(record('slot')) },
    booking: { upsert: jest.fn(record('booking')) },
    review: {
      aggregate: jest.fn(({ where }: { where: { tutorProfileId: string } }) => {
        calls.push(`aggregate:${where.tutorProfileId}`);
        const totals = stored.get(where.tutorProfileId);
        return Promise.resolve({
          _count: totals?.count ?? 0,
          _max: { createdAt: totals?.latest ?? null },
          _sum: totals?.sums ?? { clarity: null, preparation: null, punctuality: null },
        });
      }),
      upsert: reviewUpsert,
    },
    tutorProfile: {
      update: jest.fn((args: { where: { userId: string } }) => {
        calls.push(`cache:${args.where.userId}`);
        return Promise.resolve({});
      }),
    },
  };
  return { calls, client, typed: client as unknown as SeedTransactionClient };
}

const allReviews = REVIEW_FIXTURES.flatMap((tutor) =>
  tutor.reviews.map((review) => ({ ...review, tutor })),
);
const lastReviewOf = (tutorId: string) =>
  allReviews.filter(({ tutor }) => tutor.tutorUserId === tutorId).at(-1);
/** Reviews are written two hours after the one-hour class ends. */
const reviewedAt = (tutorId: string): Date =>
  new Date((lastReviewOf(tutorId)?.startAtUtc.getTime() ?? NaN) + 3 * 60 * 60 * 1000);

describe('seedReviewFixtures (S3-T19)', () => {
  it('gives Mali and Kiet real reviews and leaves Anan without one', () => {
    expect(REVIEW_FIXTURES.map(({ tutorUserId }) => tutorUserId)).toEqual([MALI_ID, KIET_ID]);
    expect(
      REVIEW_FIXTURES.map(({ reviews }) =>
        reviews.map(({ scores }) => [scores.clarity, scores.punctuality, scores.preparation]),
      ),
    ).toEqual([
      [
        [5, 4, 5],
        [4, 4, 4],
      ],
      [[4, 4, 4]],
    ]);
  });

  it('creates each reviewed class once by fixed ID and never updates an existing row', async () => {
    const { client, typed } = createClient();

    await seedReviewFixtures(typed, { studentUserId: STUDENT_ID });

    for (const upsert of [
      client.availabilitySlot.upsert,
      client.booking.upsert,
      client.review.upsert,
    ]) {
      expect(upsert).toHaveBeenCalledTimes(3);
      for (const [args] of upsert.mock.calls as unknown as [{ update: unknown }][]) {
        expect(args.update).toEqual({});
      }
    }
    expect(
      (client.review.upsert.mock.calls as unknown as [{ where: { id: string } }][]).map(
        ([args]) => args.where.id,
      ),
    ).toEqual(allReviews.map(({ reviewId }) => reviewId));
  });

  it('backs every review with a completed, attended, paid class the student owns', async () => {
    const { client, typed } = createClient();

    await seedReviewFixtures(typed, { studentUserId: STUDENT_ID });

    const bookings = (
      client.booking.upsert.mock.calls as unknown as [{ create: Record<string, unknown> }][]
    ).map(([args]) => args.create);
    const reviews = (
      client.review.upsert.mock.calls as unknown as [{ create: Record<string, unknown> }][]
    ).map(([args]) => args.create);
    bookings.forEach((booking, index) => {
      const fixture = allReviews[index];
      expect(booking).toMatchObject({
        attendance: AttendanceStatus.ATTENDED,
        id: fixture?.bookingId,
        listingId: fixture?.tutor.listingId,
        netAmount: fixture?.tutor.pricePerHour,
        paymentStatus: PaymentStatus.PAID,
        slotId: fixture?.slotId,
        status: BookingStatus.COMPLETED,
        studentUserId: STUDENT_ID,
        tutorProfileId: fixture?.tutor.tutorUserId,
      });
      expect(String(booking['mockReference'])).toMatch(/^DEMO-SEED-REVIEW-\d{3}$/);
      expect(reviews[index]).toMatchObject({
        authorStudentUserId: STUDENT_ID,
        bookingId: fixture?.bookingId,
        bookingStatus: BookingStatus.COMPLETED,
        tutorProfileId: fixture?.tutor.tutorUserId,
      });
    });
    expect(new Set(bookings.map((booking) => booking['mockReference'])).size).toBe(3);
  });

  it('places every class in the past, one hour at 17:00 Bangkok, reviewed after it ended', async () => {
    const { client, typed } = createClient();

    await seedReviewFixtures(typed, { studentUserId: STUDENT_ID });

    const slots = (
      client.availabilitySlot.upsert.mock.calls as unknown as [
        { create: { startAtUtc: Date; endAtUtc: Date } },
      ][]
    ).map(([args]) => args.create);
    slots.forEach(({ endAtUtc, startAtUtc }, index) => {
      expect(new Date(startAtUtc.getTime() + BANGKOK_OFFSET_MS).getUTCHours()).toBe(17);
      expect(endAtUtc.getTime() - startAtUtc.getTime()).toBe(60 * 60 * 1000);
      expect(endAtUtc.getTime()).toBeLessThan(Date.now());
      const review = (
        client.review.upsert.mock.calls[index] as unknown as [{ create: { createdAt: Date } }]
      )[0].create;
      expect(review.createdAt.getTime()).toBeGreaterThan(endAtUtc.getTime());
    });
  });

  it('rebuilds each cache with S3-T17 from stored reviews, under the tutor row lock', async () => {
    const { calls, client, typed } = createClient();

    await seedReviewFixtures(typed, { studentUserId: STUDENT_ID });

    for (const tutorId of [MALI_ID, KIET_ID]) {
      const lock = calls.indexOf(`lock:${tutorId}`);
      expect(lock).toBeGreaterThan(calls.indexOf(`review:${lastReviewOf(tutorId)?.reviewId}`));
      expect(calls.indexOf(`aggregate:${tutorId}`)).toBeGreaterThan(lock);
      expect(calls.indexOf(`cache:${tutorId}`)).toBeGreaterThan(lock);
    }
    expect(client.tutorProfile.update.mock.calls).toEqual([
      [
        {
          data: {
            ratingAverage: new Prisma.Decimal('4.33'),
            ratingUpdatedAt: reviewedAt(MALI_ID),
            reviewCount: 2,
          },
          where: { userId: MALI_ID },
        },
      ],
      [
        {
          data: {
            ratingAverage: new Prisma.Decimal('4.00'),
            ratingUpdatedAt: reviewedAt(KIET_ID),
            reviewCount: 1,
          },
          where: { userId: KIET_ID },
        },
      ],
    ]);
  });
});

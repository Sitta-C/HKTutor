import { AttendanceStatus, BookingStatus, PaymentStatus } from '@generated/prisma/client';
import { refreshLockedTutorReviewRating } from '@modules/reviews/review-ratings';

import type { Prisma } from '@generated/prisma/client';
import type { SeedTransactionClient } from '@infrastructure/database/seed/seed-client';
import type { StudentSeedResult } from '@infrastructure/database/seed/student.seed';

const HOUR_MS = 60 * 60 * 1000;

interface ReviewFixture {
  slotId: string;
  bookingId: string;
  reviewId: string;
  /** A finished one-hour class at 17:00 Asia/Bangkok. */
  startAtUtc: Date;
  scores: { clarity: number; punctuality: number; preparation: number };
  feedback: string;
}

interface TutorReviewFixtures {
  tutorUserId: string;
  listingId: string;
  pricePerHour: string;
  reviews: ReviewFixture[];
}

/**
 * S3-T19 search fixtures with real rating history: each rating comes from a completed booking and
 * its review, never from seeded aggregate values. Mali's 5/4/5 and 4/4/4 is the approved product
 * example (raw 4.333..., displayed 4.33); Kiet's 4/4/4 is exactly 4.00. Anan stays without reviews
 * so the live demo can still show the New tutor state before its first review.
 */
export const REVIEW_FIXTURES: readonly TutorReviewFixtures[] = [
  {
    tutorUserId: '20000000-0000-4000-8000-000000000001',
    listingId: '10000000-0000-4000-8000-000000000002',
    pricePerHour: '350.00',
    reviews: [
      {
        slotId: '30000000-0000-4000-8000-000000000201',
        bookingId: '40000000-0000-4000-8000-000000000201',
        reviewId: '50000000-0000-4000-8000-000000000201',
        startAtUtc: new Date('2026-09-15T10:00:00.000Z'),
        scores: { clarity: 5, punctuality: 4, preparation: 5 },
        feedback: 'Clear explanations and well-prepared practice questions.',
      },
      {
        slotId: '30000000-0000-4000-8000-000000000202',
        bookingId: '40000000-0000-4000-8000-000000000202',
        reviewId: '50000000-0000-4000-8000-000000000202',
        startAtUtc: new Date('2026-09-22T10:00:00.000Z'),
        scores: { clarity: 4, punctuality: 4, preparation: 4 },
        feedback: 'A helpful lesson that covered the topics I asked about.',
      },
    ],
  },
  {
    tutorUserId: '20000000-0000-4000-8000-000000000002',
    listingId: '10000000-0000-4000-8000-000000000003',
    pricePerHour: '500.00',
    reviews: [
      {
        slotId: '30000000-0000-4000-8000-000000000203',
        bookingId: '40000000-0000-4000-8000-000000000203',
        reviewId: '50000000-0000-4000-8000-000000000203',
        startAtUtc: new Date('2026-09-18T10:00:00.000Z'),
        scores: { clarity: 4, punctuality: 4, preparation: 4 },
        feedback: 'Good pace and patient answers to every question.',
      },
    ],
  },
];

/**
 * Additive and repeatable: rows are created once by fixed ID and never updated, so a re-run does
 * not reset live reviews or booking history. Each tutor's rating cache is then rebuilt from all of
 * its stored reviews with S3-T17's refresh, under the same tutor row lock review creation takes.
 */
export async function seedReviewFixtures(
  client: SeedTransactionClient,
  student: StudentSeedResult,
): Promise<void> {
  for (const tutor of REVIEW_FIXTURES) {
    for (const fixture of tutor.reviews) {
      await seedReviewedClass(client, student, tutor, fixture);
    }
    await client.$queryRaw`SELECT "userId" FROM "TutorProfile" WHERE "userId" = ${tutor.tutorUserId}::uuid FOR UPDATE`;
    // The seed transaction is a full Prisma transaction at runtime; the seed type only narrows it.
    await refreshLockedTutorReviewRating(client as Prisma.TransactionClient, tutor.tutorUserId);
  }
}

async function seedReviewedClass(
  client: SeedTransactionClient,
  student: StudentSeedResult,
  tutor: TutorReviewFixtures,
  fixture: ReviewFixture,
): Promise<void> {
  const endAtUtc = new Date(fixture.startAtUtc.getTime() + HOUR_MS);
  await client.availabilitySlot.upsert({
    where: { id: fixture.slotId },
    update: {},
    create: {
      id: fixture.slotId,
      tutorProfileId: tutor.tutorUserId,
      startAtUtc: fixture.startAtUtc,
      endAtUtc,
    },
  });
  await client.booking.upsert({
    where: { id: fixture.bookingId },
    update: {},
    create: {
      id: fixture.bookingId,
      studentUserId: student.studentUserId,
      tutorProfileId: tutor.tutorUserId,
      listingId: tutor.listingId,
      slotId: fixture.slotId,
      status: BookingStatus.COMPLETED,
      subtotalAmount: tutor.pricePerHour,
      discountAmount: '0.00',
      netAmount: tutor.pricePerHour,
      currency: 'THB',
      paymentStatus: PaymentStatus.PAID,
      // A fixed DEMO- value; no real payment data is stored.
      mockReference: `DEMO-SEED-REVIEW-${fixture.bookingId.slice(-3)}`,
      paidAt: new Date(fixture.startAtUtc.getTime() - 24 * HOUR_MS),
      attendance: AttendanceStatus.ATTENDED,
      attendanceMarkedAt: new Date(endAtUtc.getTime() + 15 * 60 * 1000),
    },
  });
  await client.review.upsert({
    where: { id: fixture.reviewId },
    update: {},
    create: {
      id: fixture.reviewId,
      bookingId: fixture.bookingId,
      authorStudentUserId: student.studentUserId,
      tutorProfileId: tutor.tutorUserId,
      bookingStatus: BookingStatus.COMPLETED,
      ...fixture.scores,
      feedback: fixture.feedback,
      createdAt: new Date(endAtUtc.getTime() + 2 * HOUR_MS),
    },
  });
}

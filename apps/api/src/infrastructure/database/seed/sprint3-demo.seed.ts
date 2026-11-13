import { AttendanceStatus, BookingStatus, PaymentStatus } from '@generated/prisma/client';
import { SEEDED_MATHEMATICS_GRADE10_LISTING_ID } from '@infrastructure/database/seed/booking-fixtures.seed';
import { demoWindow } from '@infrastructure/database/seed/sprint2-demo.seed';

import type { SeedTransactionClient } from '@infrastructure/database/seed/seed-client';
import type { StudentSeedResult } from '@infrastructure/database/seed/student.seed';
import type { TutorFoundationSeedResult } from '@infrastructure/database/seed/tutor-foundation.seed';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Fixed IDs in a range no earlier seed uses, so re-running finds the same rows. */
export const SPRINT3_DEMO_IDS = {
  reviewReadySlot: '30000000-0000-4000-8000-000000000301',
  reviewReadyBooking: '40000000-0000-4000-8000-000000000301',
} as const;

export const SPRINT3_DEMO_MEETING_URL = 'https://meet.example.com/hktutor-sprint3-demo';
export const SPRINT3_DEMO_PAYMENT_REFERENCE = 'DEMO-SEED-S3-REVIEW-READY';
/** Anan's Mathematics Grade 10 listing costs 400.00 per hour; the class lasts one hour. */
const DEMO_CLASS_AMOUNT = '400.00';
const REVIEW_READY_DAYS_AGO = 3;

/**
 * S3-T40: one finished class the operational student can review during the Sprint 3 demo, without
 * first recording attendance on the Sprint 2 ended class. The class is completed, attended and
 * mock-paid three Bangkok days before the seed run, so it also gives the tutor report a paid,
 * completed booking. Anan keeps no review until the student writes one live, so the New tutor
 * state is still shown first.
 *
 * Create-only: once the booking exists it is never changed again, which preserves a review, a
 * report history or any other evidence produced during a rehearsal. A fully repeatable rehearsal
 * therefore starts from a fresh database.
 */
export async function seedSprint3Demo(
  client: SeedTransactionClient,
  foundation: TutorFoundationSeedResult,
  student: StudentSeedResult,
  now: Date = new Date(),
): Promise<void> {
  const existing = await client.booking.findUnique({
    where: { id: SPRINT3_DEMO_IDS.reviewReadyBooking },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  const window = demoWindow(now, -REVIEW_READY_DAYS_AGO);
  await client.availabilitySlot.upsert({
    where: { id: SPRINT3_DEMO_IDS.reviewReadySlot },
    update: {},
    create: {
      id: SPRINT3_DEMO_IDS.reviewReadySlot,
      tutorProfileId: foundation.tutorUserId,
      ...window,
    },
  });
  await client.booking.create({
    data: {
      id: SPRINT3_DEMO_IDS.reviewReadyBooking,
      studentUserId: student.studentUserId,
      tutorProfileId: foundation.tutorUserId,
      listingId: SEEDED_MATHEMATICS_GRADE10_LISTING_ID,
      slotId: SPRINT3_DEMO_IDS.reviewReadySlot,
      status: BookingStatus.COMPLETED,
      subtotalAmount: DEMO_CLASS_AMOUNT,
      discountAmount: '0.00',
      netAmount: DEMO_CLASS_AMOUNT,
      currency: 'THB',
      paymentStatus: PaymentStatus.PAID,
      mockReference: SPRINT3_DEMO_PAYMENT_REFERENCE,
      // Paid when it was confirmed, two days before the class.
      paidAt: new Date(window.startAtUtc.getTime() - 2 * DAY_MS),
      meetingUrl: SPRINT3_DEMO_MEETING_URL,
      attendance: AttendanceStatus.ATTENDED,
      attendanceMarkedAt: new Date(window.endAtUtc.getTime() + HOUR_MS),
      createdAt: new Date(window.startAtUtc.getTime() - 3 * DAY_MS),
    },
  });
}

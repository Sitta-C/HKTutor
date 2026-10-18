import { BookingStatus, PaymentStatus } from '@generated/prisma/client';
import { SEEDED_MATHEMATICS_GRADE10_LISTING_ID } from '@infrastructure/database/seed/booking-fixtures.seed';

import type { SeedTransactionClient } from '@infrastructure/database/seed/seed-client';
import type { StudentSeedResult } from '@infrastructure/database/seed/student.seed';
import type { TutorFoundationSeedResult } from '@infrastructure/database/seed/tutor-foundation.seed';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** HKTutor's business timezone is Asia/Bangkok (UTC+7, no daylight saving time). */
const BANGKOK_OFFSET_MS = 7 * HOUR_MS;
const DEMO_HOUR_BANGKOK = 17;

/**
 * Fixed IDs so that re-running the seed repairs the same rows instead of adding more. The S1 slot
 * (`30000000-…0001`, day +7) stays in booking-fixtures.seed.ts.
 */
export const SPRINT2_DEMO_IDS = {
  /** Open slots for the live booking, reschedule and cancellation steps (days +8 to +10). */
  openSlots: [
    { id: '30000000-0000-4000-8000-000000000002', daysAhead: 8 },
    { id: '30000000-0000-4000-8000-000000000003', daysAhead: 9 },
    { id: '30000000-0000-4000-8000-000000000004', daysAhead: 10 },
  ],
  /** Yesterday's class: confirmed, paid and linked, waiting for the tutor to record attendance. */
  endedClassSlot: '30000000-0000-4000-8000-000000000101',
  endedClassBooking: '40000000-0000-4000-8000-000000000101',
} as const;

export const SPRINT2_DEMO_MEETING_URL = 'https://meet.example.com/hktutor-sprint2-demo';
export const SPRINT2_DEMO_PAYMENT_REFERENCE = 'DEMO-SEED-ENDED-CLASS';
/** Anan's published Mathematics Grade 10 listing costs 400.00 per hour; demo classes last 1 hour. */
const DEMO_CLASS_AMOUNT = '400.00';

/** A one-hour class at 17:00 Bangkok time, `daysOffset` Bangkok calendar days from `now`. */
export function demoWindow(now: Date, daysOffset: number): { startAtUtc: Date; endAtUtc: Date } {
  const bangkokNow = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const bangkokMidnightUtc =
    Date.UTC(bangkokNow.getUTCFullYear(), bangkokNow.getUTCMonth(), bangkokNow.getUTCDate()) -
    BANGKOK_OFFSET_MS;
  const startAtUtc = new Date(
    bangkokMidnightUtc + daysOffset * DAY_MS + DEMO_HOUR_BANGKOK * HOUR_MS,
  );
  return { startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + HOUR_MS) };
}

/**
 * Sprint 2 demonstration states that cannot be produced live during a demo. Everything else
 * (booking, confirmation, payment, chat, reschedule, cancellation, document review) is performed
 * through the UI on the open slots, so the demo exercises real flows rather than seeded results.
 *
 * Re-running is safe: an open slot that a live booking now holds is left exactly as it is, and
 * the ended class is reset to "confirmed, paid, attendance not recorded". No real payment data is
 * stored; the reference is a fixed DEMO- value.
 */
export async function seedSprint2Demo(
  client: SeedTransactionClient,
  foundation: TutorFoundationSeedResult,
  student: StudentSeedResult,
  now: Date = new Date(),
): Promise<void> {
  // Later slots move first: when the calendar day has advanced since the last seed, each slot
  // moves into the window the next one is vacating, which the no-overlap exclusion would refuse
  // if the earlier slot moved first.
  const latestFirst = [...SPRINT2_DEMO_IDS.openSlots].sort((a, b) => b.daysAhead - a.daysAhead);
  for (const slot of latestFirst) {
    const held = await client.booking.findFirst({
      where: {
        slotId: slot.id,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
      select: { id: true },
    });
    if (held) {
      continue;
    }
    const { startAtUtc, endAtUtc } = demoWindow(now, slot.daysAhead);
    await client.availabilitySlot.upsert({
      where: { id: slot.id },
      update: { tutorProfileId: foundation.tutorUserId, startAtUtc, endAtUtc, deletedAt: null },
      create: { id: slot.id, tutorProfileId: foundation.tutorUserId, startAtUtc, endAtUtc },
    });
  }

  const ended = demoWindow(now, -1);
  await client.availabilitySlot.upsert({
    where: { id: SPRINT2_DEMO_IDS.endedClassSlot },
    update: { tutorProfileId: foundation.tutorUserId, ...ended, deletedAt: null },
    create: {
      id: SPRINT2_DEMO_IDS.endedClassSlot,
      tutorProfileId: foundation.tutorUserId,
      ...ended,
    },
  });

  const endedClass = {
    status: BookingStatus.CONFIRMED,
    paymentStatus: PaymentStatus.PAID,
    mockReference: SPRINT2_DEMO_PAYMENT_REFERENCE,
    // Paid when it was confirmed, two days before the class.
    paidAt: new Date(ended.startAtUtc.getTime() - 2 * DAY_MS),
    meetingUrl: SPRINT2_DEMO_MEETING_URL,
    attendance: null,
    attendanceMarkedAt: null,
    canceledAt: null,
    canceledById: null,
    cancellationReason: null,
  };
  await client.booking.upsert({
    where: { id: SPRINT2_DEMO_IDS.endedClassBooking },
    update: endedClass,
    create: {
      id: SPRINT2_DEMO_IDS.endedClassBooking,
      studentUserId: student.studentUserId,
      tutorProfileId: foundation.tutorUserId,
      listingId: SEEDED_MATHEMATICS_GRADE10_LISTING_ID,
      slotId: SPRINT2_DEMO_IDS.endedClassSlot,
      subtotalAmount: DEMO_CLASS_AMOUNT,
      discountAmount: '0.00',
      netAmount: DEMO_CLASS_AMOUNT,
      currency: 'THB',
      ...endedClass,
    },
  });
}

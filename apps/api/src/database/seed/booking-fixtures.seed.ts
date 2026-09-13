import type { SeedTransactionClient } from '@/database/seed/seed-client';
import type { TutorFoundationSeedResult } from '@/database/seed/tutor-foundation.seed';

const SEEDED_MATHEMATICS_GRADE10_LISTING_ID = '10000000-0000-4000-8000-000000000001';

export const SEEDED_BOOKABLE_SLOT_ID = '30000000-0000-4000-8000-000000000001';

const DEMO_SLOT_DAYS_AHEAD = 7;

function nextBookableDemoSlot(now = new Date()): { startAtUtc: Date; endAtUtc: Date } {
  const startAtUtc = new Date(now);
  startAtUtc.setUTCDate(startAtUtc.getUTCDate() + DEMO_SLOT_DAYS_AHEAD);
  startAtUtc.setUTCHours(10, 0, 0, 0); // 17:00 in Bangkok.
  return {
    startAtUtc,
    endAtUtc: new Date(startAtUtc.getTime() + 60 * 60 * 1000),
  };
}

export async function seedBookingFixtures(
  client: SeedTransactionClient,
  foundation: TutorFoundationSeedResult,
): Promise<void> {
  const { startAtUtc, endAtUtc } = nextBookableDemoSlot();
  await client.availabilitySlot.upsert({
    where: { id: SEEDED_BOOKABLE_SLOT_ID },
    update: {
      tutorProfileId: foundation.tutorUserId,
      startAtUtc,
      endAtUtc,
      deletedAt: null,
    },
    create: {
      id: SEEDED_BOOKABLE_SLOT_ID,
      tutorProfileId: foundation.tutorUserId,
      startAtUtc,
      endAtUtc,
    },
  });
}

export { SEEDED_MATHEMATICS_GRADE10_LISTING_ID };

import type { SeedTransactionClient } from '@/database/seed/seed-client';
import type { TutorFoundationSeedResult } from '@/database/seed/tutor-foundation.seed';

const SEEDED_MATHEMATICS_GRADE10_LISTING_ID = '10000000-0000-4000-8000-000000000001';

export const SEEDED_BOOKABLE_SLOT_ID = '30000000-0000-4000-8000-000000000001';

/**
 * Far enough in the future to stay valid regardless of when the seed is run,
 * without needing a moving Date.now() offset that would change on every run.
 */
const SLOT_START_AT_UTC = new Date('2030-01-01T10:00:00.000Z');
const SLOT_END_AT_UTC = new Date('2030-01-01T11:00:00.000Z');

export async function seedBookingFixtures(
  client: SeedTransactionClient,
  foundation: TutorFoundationSeedResult,
): Promise<void> {
  await client.availabilitySlot.upsert({
    where: { id: SEEDED_BOOKABLE_SLOT_ID },
    update: {
      tutorProfileId: foundation.tutorUserId,
      startAtUtc: SLOT_START_AT_UTC,
      endAtUtc: SLOT_END_AT_UTC,
      deletedAt: null,
    },
    create: {
      id: SEEDED_BOOKABLE_SLOT_ID,
      tutorProfileId: foundation.tutorUserId,
      startAtUtc: SLOT_START_AT_UTC,
      endAtUtc: SLOT_END_AT_UTC,
    },
  });
}

export { SEEDED_MATHEMATICS_GRADE10_LISTING_ID };

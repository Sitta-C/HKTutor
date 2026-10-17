import { BookingStatus, PaymentStatus } from '@generated/prisma/client';
import {
  SPRINT2_DEMO_IDS,
  SPRINT2_DEMO_MEETING_URL,
  SPRINT2_DEMO_PAYMENT_REFERENCE,
  demoWindow,
  seedSprint2Demo,
} from '@infrastructure/database/seed/sprint2-demo.seed';

import type { Prisma } from '@generated/prisma/client';
import type { SeedTransactionClient } from '@infrastructure/database/seed/seed-client';

const foundation = {
  tutorUserId: 'tutor-user-id',
  mathematicsSubjectId: 'mathematics-id',
  grade10Id: 'grade-10-id',
};
const student = { studentUserId: 'student-user-id' };
/** 01:30 on 18 October in Bangkok, which is still 17 October in UTC. */
const NOW = new Date('2026-10-17T18:30:00.000Z');

function createClient(heldSlotIds: string[] = []) {
  const findFirst = jest.fn((args: Prisma.BookingFindFirstArgs) => {
    const slotId = args.where?.slotId;
    return Promise.resolve(
      typeof slotId === 'string' && heldSlotIds.includes(slotId) ? { id: 'live-booking-id' } : null,
    );
  });
  const slotUpsert = jest
    .fn<Promise<{ id: string }>, [Prisma.AvailabilitySlotUpsertArgs]>()
    .mockResolvedValue({ id: 'slot' });
  const bookingUpsert = jest
    .fn<Promise<{ id: string }>, [Prisma.BookingUpsertArgs]>()
    .mockResolvedValue({ id: 'booking' });
  return {
    client: {
      availabilitySlot: { upsert: slotUpsert },
      booking: { findFirst, upsert: bookingUpsert },
    } as unknown as SeedTransactionClient,
    bookingUpsert,
    slotUpsert,
  };
}

describe('seedSprint2Demo', () => {
  it('places demo classes at 17:00 on Bangkok calendar days, not UTC days', () => {
    expect(demoWindow(NOW, 8)).toEqual({
      startAtUtc: new Date('2026-10-26T10:00:00.000Z'),
      endAtUtc: new Date('2026-10-26T11:00:00.000Z'),
    });
    expect(demoWindow(NOW, -1).startAtUtc).toEqual(new Date('2026-10-17T10:00:00.000Z'));
  });

  it('creates three free future slots and an ended, paid class awaiting attendance', async () => {
    const { client, bookingUpsert, slotUpsert } = createClient();

    await seedSprint2Demo(client, foundation, student, NOW);

    const slots = slotUpsert.mock.calls.map(([args]) => args.create);
    expect(slots.map((slot) => slot.id)).toEqual([
      '30000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000002',
      SPRINT2_DEMO_IDS.endedClassSlot,
    ]);
    for (const slot of slots.slice(0, 3)) {
      expect(new Date(slot.startAtUtc).getTime()).toBeGreaterThan(NOW.getTime());
    }
    const ended = slots[3];
    expect(new Date(ended?.endAtUtc ?? 0).getTime()).toBeLessThan(NOW.getTime());

    const booking = bookingUpsert.mock.calls[0]?.[0];
    expect(booking?.where).toEqual({ id: SPRINT2_DEMO_IDS.endedClassBooking });
    expect(booking?.create).toMatchObject({
      attendance: null,
      attendanceMarkedAt: null,
      listingId: '10000000-0000-4000-8000-000000000001',
      meetingUrl: SPRINT2_DEMO_MEETING_URL,
      mockReference: SPRINT2_DEMO_PAYMENT_REFERENCE,
      netAmount: '400.00',
      paymentStatus: PaymentStatus.PAID,
      slotId: SPRINT2_DEMO_IDS.endedClassSlot,
      status: BookingStatus.CONFIRMED,
      studentUserId: 'student-user-id',
      tutorProfileId: 'tutor-user-id',
    });
    expect(new Date(booking?.create.paidAt ?? 0).getTime()).toBeLessThan(NOW.getTime());
  });

  it('resets the ended class on re-seed so attendance can be recorded again', async () => {
    const { client, bookingUpsert } = createClient();

    await seedSprint2Demo(client, foundation, student, NOW);

    expect(bookingUpsert.mock.calls[0]?.[0].update).toMatchObject({
      attendance: null,
      attendanceMarkedAt: null,
      canceledAt: null,
      status: BookingStatus.CONFIRMED,
    });
  });

  it('never moves an open slot that a live booking now holds', async () => {
    const held = '30000000-0000-4000-8000-000000000003';
    const { client, slotUpsert } = createClient([held]);

    await seedSprint2Demo(client, foundation, student, NOW);

    expect(slotUpsert.mock.calls.map(([args]) => args.where.id)).not.toContain(held);
    expect(slotUpsert).toHaveBeenCalledTimes(3);
  });

  it('uses only DEMO- payment data', () => {
    expect(SPRINT2_DEMO_PAYMENT_REFERENCE).toMatch(/^DEMO-/);
    expect(SPRINT2_DEMO_MEETING_URL).toMatch(/^https:\/\/meet\.example\.com\//);
  });
});

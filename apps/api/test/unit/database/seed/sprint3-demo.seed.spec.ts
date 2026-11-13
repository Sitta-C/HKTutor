import { AttendanceStatus, BookingStatus, PaymentStatus } from '@generated/prisma/client';
import { SPRINT2_DEMO_IDS } from '@infrastructure/database/seed/sprint2-demo.seed';
import {
  SPRINT3_DEMO_IDS,
  SPRINT3_DEMO_MEETING_URL,
  SPRINT3_DEMO_PAYMENT_REFERENCE,
  seedSprint3Demo,
} from '@infrastructure/database/seed/sprint3-demo.seed';

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

function createClient(existing = false) {
  const findUnique = jest.fn().mockResolvedValue(existing ? { id: 'existing' } : null);
  const slotUpsert = jest
    .fn<Promise<{ id: string }>, [Prisma.AvailabilitySlotUpsertArgs]>()
    .mockResolvedValue({ id: 'slot' });
  const bookingCreate = jest
    .fn<Promise<{ id: string }>, [Prisma.BookingCreateArgs]>()
    .mockResolvedValue({ id: 'booking' });
  const client = {
    booking: { findUnique, create: bookingCreate },
    availabilitySlot: { upsert: slotUpsert },
  } as unknown as SeedTransactionClient;
  return { client, findUnique, slotUpsert, bookingCreate };
}

describe('seedSprint3Demo (S3-T40)', () => {
  it('creates a completed, attended, mock-paid class three Bangkok days ago with no review', async () => {
    const { client, slotUpsert, bookingCreate } = createClient();

    await seedSprint3Demo(client, foundation, student, NOW);

    const slot = slotUpsert.mock.calls[0]?.[0];
    expect(slot?.create).toEqual({
      id: SPRINT3_DEMO_IDS.reviewReadySlot,
      tutorProfileId: foundation.tutorUserId,
      // 15 October 17:00 Bangkok = 10:00 UTC (18 October Bangkok minus three days).
      startAtUtc: new Date('2026-10-15T10:00:00.000Z'),
      endAtUtc: new Date('2026-10-15T11:00:00.000Z'),
    });
    expect(slot?.update).toEqual({});
    expect(bookingCreate.mock.calls[0]?.[0].data).toMatchObject({
      id: SPRINT3_DEMO_IDS.reviewReadyBooking,
      studentUserId: student.studentUserId,
      tutorProfileId: foundation.tutorUserId,
      slotId: SPRINT3_DEMO_IDS.reviewReadySlot,
      status: BookingStatus.COMPLETED,
      paymentStatus: PaymentStatus.PAID,
      attendance: AttendanceStatus.ATTENDED,
      subtotalAmount: '400.00',
      discountAmount: '0.00',
      netAmount: '400.00',
      mockReference: SPRINT3_DEMO_PAYMENT_REFERENCE,
      meetingUrl: SPRINT3_DEMO_MEETING_URL,
      attendanceMarkedAt: new Date('2026-10-15T12:00:00.000Z'),
      paidAt: new Date('2026-10-13T10:00:00.000Z'),
    });
    expect(bookingCreate.mock.calls[0]?.[0].data).not.toHaveProperty('review');
  });

  it('never changes an existing demo class, so a rehearsal review and history survive re-seeding', async () => {
    const { client, slotUpsert, bookingCreate } = createClient(true);

    await seedSprint3Demo(client, foundation, student, NOW);

    expect(slotUpsert).not.toHaveBeenCalled();
    expect(bookingCreate).not.toHaveBeenCalled();
  });

  it('uses its own fixed IDs, a DEMO- payment reference and an https meeting link', () => {
    expect(SPRINT3_DEMO_IDS.reviewReadySlot).not.toBe(SPRINT2_DEMO_IDS.endedClassSlot);
    expect(SPRINT3_DEMO_IDS.reviewReadyBooking).not.toBe(SPRINT2_DEMO_IDS.endedClassBooking);
    expect(SPRINT3_DEMO_PAYMENT_REFERENCE).toMatch(/^DEMO-/);
    expect(SPRINT3_DEMO_MEETING_URL).toMatch(/^https:\/\//);
  });
});

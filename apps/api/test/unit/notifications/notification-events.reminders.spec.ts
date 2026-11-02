import { AccountStatus, BookingStatus, PaymentStatus } from '@generated/prisma/client';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { planReminders } from '@modules/notifications/reminder-policy';

import type {
  PlannedReminder,
  ReminderBooking,
  ReminderEventType,
} from '@modules/notifications/reminder-policy';

// S3-T06: reminder rows are written through the same notification service as booking events.

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BOOKING_ID = '66666666-6666-4666-8666-666666666666';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const TUTOR_ID = '55555555-5555-4555-8555-555555555555';

const booking: ReminderBooking = {
  id: BOOKING_ID,
  slotId: '22222222-2222-4222-8222-222222222222',
  startAtUtc: new Date('2026-11-10T11:00:00.000Z'),
  status: BookingStatus.CONFIRMED,
  paymentStatus: PaymentStatus.UNPAID,
  student: { userId: STUDENT_ID, accountStatus: AccountStatus.ACTIVE, deletedAt: null },
  tutor: { userId: TUTOR_ID, accountStatus: AccountStatus.ACTIVE, deletedAt: null },
};
const NOW_24H = new Date('2026-11-09T11:00:00.000Z');
const NOW_1H = new Date('2026-11-10T10:00:00.000Z');

const REMINDER_COPY_CASES: { eventType: ReminderEventType; title: string; body: string }[] = [
  {
    eventType: 'CLASS_REMINDER_24H',
    title: 'Class starts within 24 hours',
    body: 'Your lesson starts within 24 hours.',
  },
  {
    eventType: 'CLASS_REMINDER_1H',
    title: 'Class starts within 1 hour',
    body: 'Your lesson starts within 1 hour.',
  },
  {
    eventType: 'PAYMENT_REMINDER_24H',
    title: 'Payment due for your class',
    body: 'Your lesson starts within 24 hours and is still unpaid.',
  },
  {
    eventType: 'PAYMENT_REMINDER_1H',
    title: 'Payment due for your class',
    body: 'Your lesson starts within 1 hour and is still unpaid.',
  },
];

describe('NotificationEventsService.writeReminders (S3-T06)', () => {
  const service = new NotificationEventsService();
  const createMany = jest.fn();
  const tx = { notification: { createMany } };

  beforeEach(() => {
    createMany.mockReset().mockResolvedValue({ count: 3 });
  });

  it('writes every planned reminder in one skip-duplicates insert linked to the booking', async () => {
    const planned = planReminders(booking, NOW_24H);

    await expect(service.writeReminders(tx, BOOKING_ID, planned)).resolves.toBe(3);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({
      data: planned.map(({ eventKey, eventType, userId }) => ({
        bookingId: BOOKING_ID,
        eventKey,
        eventType,
        userId,
        title: eventType.startsWith('CLASS')
          ? 'Class starts within 24 hours'
          : 'Payment due for your class',
        body: eventType.startsWith('CLASS')
          ? 'Your lesson starts within 24 hours.'
          : 'Your lesson starts within 24 hours and is still unpaid.',
      })),
      skipDuplicates: true,
    });
    expect(planned.map(({ userId, eventType }) => [userId, eventType])).toEqual([
      [STUDENT_ID, 'CLASS_REMINDER_24H'],
      [TUTOR_ID, 'CLASS_REMINDER_24H'],
      [STUDENT_ID, 'PAYMENT_REMINDER_24H'],
    ]);
  });

  it.each(REMINDER_COPY_CASES)(
    '$eventType uses fixed text with no names, amounts or links',
    async ({ eventType, title, body }) => {
      const [reminder] = planReminders(booking, NOW_1H);
      if (!reminder) throw new Error('Expected a planned reminder');
      const planned: PlannedReminder = { ...reminder, eventType };

      await service.writeReminders(tx, BOOKING_ID, [planned]);

      expect(createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ title, body }) as unknown] }),
      );
      for (const text of [title, body]) {
        expect(text).not.toMatch(/https?:|www\.|฿|THB|\$/i);
        expect(text).not.toContain(STUDENT_ID);
        expect(text).not.toContain(TUTOR_ID);
      }
    },
  );

  it('returns zero without touching persistence when nothing is planned', async () => {
    await expect(service.writeReminders(tx, BOOKING_ID, [])).resolves.toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('counts only new rows when some reminders were already stored', async () => {
    createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const planned = planReminders(booking, NOW_1H);

    await expect(service.writeReminders(tx, BOOKING_ID, planned)).resolves.toBe(1);
    await expect(service.writeReminders(tx, BOOKING_ID, planned)).resolves.toBe(0);
  });

  it('refuses reminders planned for another booking before touching persistence', async () => {
    const planned = planReminders({ ...booking, id: OTHER_BOOKING_ID }, NOW_24H);

    await expect(service.writeReminders(tx, BOOKING_ID, planned)).rejects.toThrow(RangeError);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('propagates persistence failures so the booking transaction rolls back', async () => {
    const error = new Error('Persistence unavailable');
    createMany.mockRejectedValueOnce(error);

    await expect(
      service.writeReminders(tx, BOOKING_ID, planReminders(booking, NOW_24H)),
    ).rejects.toBe(error);
  });
});

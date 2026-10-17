import { ForbiddenException } from '@nestjs/common';

import { NotificationEventsService } from '@modules/notifications/notification-events.service';

import type { NotificationEvent } from '@modules/notifications/notification-events.service';

describe('NotificationEventsService', () => {
  const service = new NotificationEventsService();
  const createMany = jest.fn();
  const tx = { notification: { createMany } };
  const booking = { id: 'booking-1', studentUserId: 'student-1', tutorProfileId: 'tutor-1' };
  const cases: NotificationEvent[] = [
    { actorUserId: booking.studentUserId, booking, eventType: 'BOOKING_CREATED' },
    { actorUserId: booking.tutorProfileId, booking, eventType: 'BOOKING_CONFIRMED' },
    { actorUserId: booking.tutorProfileId, booking, eventType: 'BOOKING_REJECTED' },
    { actorUserId: booking.studentUserId, booking, eventType: 'BOOKING_CANCELED' },
    { actorUserId: booking.tutorProfileId, booking, eventType: 'BOOKING_CANCELED' },
    {
      actorUserId: booking.studentUserId,
      booking,
      eventType: 'RESCHEDULE_REQUESTED',
      requestId: 'request-1',
    },
    {
      actorUserId: booking.tutorProfileId,
      booking,
      eventType: 'RESCHEDULE_APPROVED',
      requestId: 'request-1',
    },
    {
      actorUserId: booking.studentUserId,
      booking,
      eventType: 'RESCHEDULE_REJECTED',
      requestId: 'tutor-request-1',
    },
    {
      actorUserId: booking.tutorProfileId,
      booking,
      eventType: 'RESCHEDULE_WITHDRAWN',
      requestId: 'tutor-request-1',
    },
  ];

  beforeEach(() => {
    createMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it.each(cases)(
    '$eventType notifies only the persisted counterparty of $actorUserId',
    async (event) => {
      await service.write(tx, event);
      const userId =
        event.actorUserId === booking.studentUserId
          ? booking.tutorProfileId
          : booking.studentUserId;
      const entityId = 'requestId' in event ? event.requestId : booking.id;
      const expected: unknown = expect.objectContaining({
        data: expect.objectContaining({
          bookingId: booking.id,
          eventKey: `${event.eventType}:${entityId}`,
          eventType: event.eventType,
          userId,
        }) as unknown,
        skipDuplicates: true,
      });
      expect(createMany).toHaveBeenCalledTimes(1);
      expect(createMany).toHaveBeenCalledWith(expected);
    },
  );

  it('refuses a nonparticipant before touching persistence', async () => {
    await expect(
      service.write(tx, { actorUserId: 'outsider', booking, eventType: 'BOOKING_CREATED' }),
    ).rejects.toThrow(ForbiddenException);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('does not notify the actor even if legacy data gives both participants the same ID', async () => {
    await service.write(tx, {
      actorUserId: 'same-user',
      booking: { ...booking, studentUserId: 'same-user', tutorProfileId: 'same-user' },
      eventType: 'BOOKING_CANCELED',
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('treats a duplicate insert as a no-op and propagates other failures to the domain transaction', async () => {
    const event: NotificationEvent = {
      actorUserId: booking.studentUserId,
      booking,
      eventType: 'BOOKING_CREATED',
    };
    createMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.write(tx, event)).resolves.toBeUndefined();
    const error = new Error('Persistence unavailable');
    createMany.mockRejectedValueOnce(error);
    await expect(service.write(tx, event)).rejects.toBe(error);
  });
});

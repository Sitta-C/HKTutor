import { ForbiddenException, Injectable } from '@nestjs/common';

import type { Prisma } from '@generated/prisma/client';

const EVENT_COPY = {
  BOOKING_CREATED: {
    title: 'New booking request',
    body: 'You have received a new lesson request.',
  },
  BOOKING_CONFIRMED: {
    title: 'Booking confirmed',
    body: 'Your lesson request has been confirmed.',
  },
  BOOKING_REJECTED: {
    title: 'Booking request declined',
    body: 'Your lesson request has been declined.',
  },
  BOOKING_CANCELED: {
    title: 'Booking canceled',
    body: 'The other participant has canceled this lesson.',
  },
  RESCHEDULE_REQUESTED: {
    title: 'New reschedule request',
    body: 'The other participant has requested a new lesson time.',
  },
  RESCHEDULE_APPROVED: {
    title: 'Reschedule approved',
    body: 'Your reschedule request has been approved.',
  },
  RESCHEDULE_REJECTED: {
    title: 'Reschedule declined',
    body: 'Your reschedule request has been declined.',
  },
  RESCHEDULE_WITHDRAWN: {
    title: 'Reschedule withdrawn',
    body: 'The other participant has withdrawn their reschedule request.',
  },
} as const;

type BookingEventType =
  'BOOKING_CREATED' | 'BOOKING_CONFIRMED' | 'BOOKING_REJECTED' | 'BOOKING_CANCELED';
type RescheduleEventType = Exclude<keyof typeof EVENT_COPY, BookingEventType>;

interface EventParticipants {
  actorUserId: string;
  booking: { id: string; studentUserId: string; tutorProfileId: string };
}

export type NotificationEvent = EventParticipants &
  ({ eventType: BookingEventType } | { eventType: RescheduleEventType; requestId: string });

/** Persists events only through the caller's domain transaction; it never sends externally. */
@Injectable()
export class NotificationEventsService {
  async write(
    tx: { notification: Pick<Prisma.TransactionClient['notification'], 'createMany'> },
    event: NotificationEvent,
  ): Promise<void> {
    const { actorUserId, booking, eventType } = event;
    if (actorUserId !== booking.studentUserId && actorUserId !== booking.tutorProfileId) {
      throw new ForbiddenException('Only booking participants can produce this notification');
    }
    const userId =
      actorUserId === booking.studentUserId ? booking.tutorProfileId : booking.studentUserId;
    if (userId === actorUserId) {
      return;
    }

    // A booking action occurs once; each reschedule round has its own immutable request ID.
    const entityId = 'requestId' in event ? event.requestId : booking.id;
    await tx.notification.createMany({
      data: {
        ...EVENT_COPY[eventType],
        bookingId: booking.id,
        eventKey: `${eventType}:${entityId}`,
        eventType,
        userId,
      },
      // PostgreSQL ON CONFLICT DO NOTHING avoids aborting the surrounding transaction on retry.
      // Existing title/body/readAt stay untouched; other persistence failures still roll back.
      skipDuplicates: true,
    });
  }
}

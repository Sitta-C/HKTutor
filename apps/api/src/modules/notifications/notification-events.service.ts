import { ForbiddenException, Injectable } from '@nestjs/common';

import type { Prisma } from '@generated/prisma/client';
import type { PlannedReminder, ReminderEventType } from '@modules/notifications/reminder-policy';

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

// S3-T06 fallback text; S3-T07 localises by eventType. No names, amounts or links (S2-T28).
const REMINDER_COPY: Record<ReminderEventType, { title: string; body: string }> = {
  CLASS_REMINDER_24H: {
    title: 'Class starts within 24 hours',
    body: 'Your lesson starts within 24 hours.',
  },
  CLASS_REMINDER_1H: {
    title: 'Class starts within 1 hour',
    body: 'Your lesson starts within 1 hour.',
  },
  PAYMENT_REMINDER_24H: {
    title: 'Payment due for your class',
    body: 'Your lesson starts within 24 hours and is still unpaid.',
  },
  PAYMENT_REMINDER_1H: {
    title: 'Payment due for your class',
    body: 'Your lesson starts within 1 hour and is still unpaid.',
  },
};

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
  /** One payment prompt per usable QR, including recovery through status reads or webhooks. */
  async writePaymentQrReady(
    tx: { notification: Pick<Prisma.TransactionClient['notification'], 'createMany'> },
    payment: { bookingId: string; studentUserId: string; attemptId: string },
  ): Promise<void> {
    await tx.notification.createMany({
      data: {
        bookingId: payment.bookingId,
        userId: payment.studentUserId,
        eventType: 'PAYMENT_QR_READY',
        eventKey: `PAYMENT_QR_READY:${payment.attemptId}`,
        title: 'Payment QR ready',
        body: 'A new payment QR was ready when this notification was sent. Open the booking to check the current payment status.',
      },
      skipDuplicates: true,
    });
  }

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

  /**
   * Writes S3-T05 planned reminders inside the reminder job's per-booking transaction and returns
   * how many rows were new; a reminder already stored for (userId, eventKey) is skipped.
   */
  async writeReminders(
    tx: { notification: Pick<Prisma.TransactionClient['notification'], 'createMany'> },
    bookingId: string,
    planned: readonly PlannedReminder[],
  ): Promise<number> {
    if (planned.length === 0) {
      return 0;
    }
    const keyPrefix = `reminder:${bookingId}:`;
    if (planned.some(({ eventKey }) => !eventKey.startsWith(keyPrefix))) {
      throw new RangeError('Planned reminder does not belong to this booking');
    }
    const { count } = await tx.notification.createMany({
      data: planned.map(({ eventKey, eventType, userId }) => ({
        ...REMINDER_COPY[eventType],
        bookingId,
        eventKey,
        eventType,
        userId,
      })),
      skipDuplicates: true,
    });
    return count;
  }
}

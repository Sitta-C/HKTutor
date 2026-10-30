import { AccountStatus, BookingStatus, PaymentStatus } from '@generated/prisma/client';

const HOUR_MS = 60 * 60 * 1000;

export const REMINDER_WINDOW_MS = { '24H': 24 * HOUR_MS, '1H': HOUR_MS } as const;

export type ReminderBand = keyof typeof REMINDER_WINDOW_MS;
export type ReminderKind = 'CLASS' | 'PAYMENT';
export type ReminderEventType = `${ReminderKind}_REMINDER_${ReminderBand}`;

export interface ReminderRecipient {
  userId: string;
  accountStatus: AccountStatus;
  deletedAt: Date | null;
}

export interface ReminderBooking {
  id: string;
  slotId: string;
  startAtUtc: Date;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  student: ReminderRecipient;
  tutor: ReminderRecipient;
}

export interface PlannedReminder {
  userId: string;
  eventType: ReminderEventType;
  eventKey: string;
}

function timeOf(value: Date, name: string): number {
  const time = value.getTime();
  if (Number.isNaN(time)) {
    throw new RangeError(`${name} must be a valid date`);
  }
  return time;
}

/**
 * Approved 2026-10-26 policy (S3-T05). With delta = start - now, 1h < delta <= 24h selects 24H
 * and 0 < delta <= 1h selects 1H, so a late first run sends one catch-up band, never both.
 * Delta is a duration, so the result does not depend on the Asia/Bangkok display time zone.
 */
export function selectReminderBand(startAtUtc: Date, nowUtc: Date): ReminderBand | null {
  const delta = timeOf(startAtUtc, 'startAtUtc') - timeOf(nowUtc, 'nowUtc');
  if (delta <= 0 || delta > REMINDER_WINDOW_MS['24H']) {
    return null;
  }
  return delta > REMINDER_WINDOW_MS['1H'] ? '24H' : '1H';
}

/** Unique per (userId, eventKey); slot and start time keep rescheduled occurrences apart. */
export function reminderEventKey(
  booking: Pick<ReminderBooking, 'id' | 'slotId' | 'startAtUtc'>,
  band: ReminderBand,
  kind: ReminderKind,
): string {
  const startAt = new Date(timeOf(booking.startAtUtc, 'startAtUtc')).toISOString();
  return `reminder:${booking.id}:${booking.slotId}:${startAt}:${band}:${kind}`;
}

function isActive(recipient: ReminderRecipient): boolean {
  return recipient.accountStatus === AccountStatus.ACTIVE && recipient.deletedAt === null;
}

/**
 * Class reminders go to both participants whether paid or not; payment reminders go only to an
 * unpaid student. Only CONFIRMED bookings qualify, and inactive or deleted recipients are skipped.
 */
export function planReminders(booking: ReminderBooking, nowUtc: Date): PlannedReminder[] {
  const band = selectReminderBand(booking.startAtUtc, nowUtc);
  if (!band || booking.status !== BookingStatus.CONFIRMED) {
    return [];
  }
  const reminder = (recipient: ReminderRecipient, kind: ReminderKind): PlannedReminder => ({
    userId: recipient.userId,
    eventType: `${kind}_REMINDER_${band}`,
    eventKey: reminderEventKey(booking, band, kind),
  });
  const unpaid = booking.paymentStatus === PaymentStatus.UNPAID;
  return [
    ...(isActive(booking.student) ? [reminder(booking.student, 'CLASS')] : []),
    ...(isActive(booking.tutor) ? [reminder(booking.tutor, 'CLASS')] : []),
    ...(unpaid && isActive(booking.student) ? [reminder(booking.student, 'PAYMENT')] : []),
  ];
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BookingStatus, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { planReminders, REMINDER_WINDOW_MS } from '@modules/notifications/reminder-policy';

import type { PlannedReminder, ReminderBooking } from '@modules/notifications/reminder-policy';

export const REMINDER_JOB_NAME = 'class-and-payment-reminders';
export const REMINDER_SCAN_PAGE_SIZE = 100;

/** Internal telemetry for one run (S3-T06/JOB-01); never an HTTP contract. */
export interface ReminderRunResult {
  scanned: number;
  created: number;
  duplicates: number;
  failed: number;
}

const recipientSelect = {
  id: true,
  accountStatus: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

const reminderBookingSelect = {
  id: true,
  slotId: true,
  status: true,
  paymentStatus: true,
  slot: { select: { startAtUtc: true } },
  student: { select: recipientSelect },
  tutorProfile: { select: { user: { select: recipientSelect } } },
} satisfies Prisma.BookingSelect;

type ReminderBookingRow = Prisma.BookingGetPayload<{ select: typeof reminderBookingSelect }>;
type RecipientRow = ReminderBookingRow['student'];

function toReminderBooking(row: ReminderBookingRow): ReminderBooking {
  const recipient = ({ id, accountStatus, deletedAt }: RecipientRow) => ({
    userId: id,
    accountStatus,
    deletedAt,
  });
  return {
    id: row.id,
    slotId: row.slotId,
    startAtUtc: row.slot.startAtUtc,
    status: row.status,
    paymentStatus: row.paymentStatus,
    student: recipient(row.student),
    // Booking.tutorProfileId is the tutor's User.id, reached through TutorProfile.userId.
    tutor: recipient(row.tutorProfile.user),
  };
}

function reminderKey({ userId, eventKey }: Pick<PlannedReminder, 'userId' | 'eventKey'>): string {
  return `${userId}\u0000${eventKey}`;
}

function errorClass(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `${error.name}/${error.code}`;
  }
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * S3-T06: the one scheduled job that writes S3-T05 class and payment reminders. There is no queue,
 * Redis or HTTP trigger; tests call runOnce with an injected clock.
 */
@Injectable()
export class ReminderJobService {
  private readonly logger = new Logger(ReminderJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  // One UTC tick per minute. waitForCompletion stops a slow run overlapping the next in this
  // process; database uniqueness protects against other processes. Jest sets NODE_ENV=test.
  @Cron(CronExpression.EVERY_MINUTE, {
    name: REMINDER_JOB_NAME,
    timeZone: 'UTC',
    waitForCompletion: true,
    disabled: process.env['NODE_ENV'] === 'test',
  })
  async tick(): Promise<void> {
    try {
      await this.runOnce(new Date());
    } catch (error) {
      this.logger.error(`Reminder run failed (${errorClass(error)}); retrying next tick`);
    }
  }

  /**
   * Scans CONFIRMED bookings starting in (now, now + 24h] by (startAtUtc, id). A scan or pre-check
   * failure aborts the run for the next tick; a failure on one booking is counted and skipped.
   */
  async runOnce(nowUtc: Date): Promise<ReminderRunResult> {
    if (Number.isNaN(nowUtc.getTime())) {
      throw new RangeError('nowUtc must be a valid date');
    }
    const totals: ReminderRunResult = { scanned: 0, created: 0, duplicates: 0, failed: 0 };
    let cursor: { startAtUtc: Date; id: string } | null = null;
    for (;;) {
      const page = await this.scanPage(nowUtc, cursor);
      const stored = await this.storedReminderKeys(page);
      for (const row of page) {
        const outcome = await this.remindBooking(row, nowUtc, stored);
        totals.scanned += 1;
        totals.created += outcome.created;
        totals.duplicates += outcome.duplicates;
        totals.failed += outcome.failed;
      }
      const last = page.at(-1);
      if (!last || page.length < REMINDER_SCAN_PAGE_SIZE) {
        break;
      }
      cursor = { startAtUtc: last.slot.startAtUtc, id: last.id };
    }
    if (totals.created > 0 || totals.failed > 0) {
      this.logger.log(
        `Reminder run: scanned=${totals.scanned} created=${totals.created} ` +
          `duplicates=${totals.duplicates} failed=${totals.failed}`,
      );
    }
    return totals;
  }

  // Keyset paging stays stable while bookings are canceled or rescheduled during the run.
  private scanPage(
    nowUtc: Date,
    cursor: { startAtUtc: Date; id: string } | null,
  ): Promise<ReminderBookingRow[]> {
    const windowEnd = new Date(nowUtc.getTime() + REMINDER_WINDOW_MS['24H']);
    const after: Prisma.BookingWhereInput[] = cursor
      ? [
          {
            OR: [
              { slot: { startAtUtc: { gt: cursor.startAtUtc } } },
              { slot: { startAtUtc: cursor.startAtUtc }, id: { gt: cursor.id } },
            ],
          },
        ]
      : [];
    return this.prisma.booking.findMany({
      where: {
        AND: [
          { status: BookingStatus.CONFIRMED, slot: { startAtUtc: { gt: nowUtc, lte: windowEnd } } },
          ...after,
        ],
      },
      orderBy: [{ slot: { startAtUtc: 'asc' } }, { id: 'asc' }],
      take: REMINDER_SCAN_PAGE_SIZE,
      select: reminderBookingSelect,
    });
  }

  // Lock-free pre-check so a booking whose reminders are all stored never takes a row lock.
  private async storedReminderKeys(page: ReminderBookingRow[]): Promise<Set<string>> {
    if (page.length === 0) {
      return new Set();
    }
    const stored = await this.prisma.notification.findMany({
      where: { bookingId: { in: page.map(({ id }) => id) }, eventKey: { startsWith: 'reminder:' } },
      select: { userId: true, eventKey: true },
    });
    return new Set(stored.map(reminderKey));
  }

  private async remindBooking(
    row: ReminderBookingRow,
    nowUtc: Date,
    stored: ReadonlySet<string>,
  ): Promise<Omit<ReminderRunResult, 'scanned'>> {
    const snapshot = planReminders(toReminderBooking(row), nowUtc);
    if (snapshot.every((reminder) => stored.has(reminderKey(reminder)))) {
      return { created: 0, duplicates: snapshot.length, failed: 0 };
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Same lock as payment, cancellation and reschedule, so the plan uses committed state.
        await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${row.id}::uuid FOR UPDATE`;
        const locked = await tx.booking.findUnique({
          where: { id: row.id },
          select: reminderBookingSelect,
        });
        const planned = locked ? planReminders(toReminderBooking(locked), nowUtc) : [];
        const created = await this.notificationEvents.writeReminders(tx, row.id, planned);
        return { created, duplicates: planned.length - created, failed: 0 };
      });
    } catch (error) {
      this.logger.warn(`Reminder booking skipped (${errorClass(error)}); retrying next tick`);
      return { created: 0, duplicates: 0, failed: 1 };
    }
  }
}

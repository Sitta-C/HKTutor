import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { Test } from '@nestjs/testing';

import { AccountStatus, BookingStatus, PaymentStatus, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import {
  REMINDER_JOB_NAME,
  REMINDER_SCAN_PAGE_SIZE,
  ReminderJobService,
} from '@modules/notifications/reminder-job.service';
import { reminderEventKey } from '@modules/notifications/reminder-policy';

// S3-T06 runOnce fixtures. The clock is injected, so every case is pinned to a fixed UTC instant.

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_BOOKING_ID = '11111111-1111-4111-8111-222222222222';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const RESCHEDULED_SLOT_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const TUTOR_ID = '55555555-5555-4555-8555-555555555555';

const START = new Date('2026-11-10T11:00:00.000Z');
const NOW_24H = new Date('2026-11-09T11:00:00.000Z');
const NOW_LATE = new Date('2026-11-10T10:30:00.000Z');
const WINDOW_END = new Date('2026-11-10T11:00:00.000Z');

interface BookingRow {
  id: string;
  slotId: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  slot: { startAtUtc: Date };
  student: { id: string; accountStatus: AccountStatus; deletedAt: Date | null };
  tutorProfile: { user: { id: string; accountStatus: AccountStatus; deletedAt: Date | null } };
}

function bookingRow(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: BOOKING_ID,
    slotId: SLOT_ID,
    status: BookingStatus.CONFIRMED,
    paymentStatus: PaymentStatus.UNPAID,
    slot: { startAtUtc: START },
    student: { id: STUDENT_ID, accountStatus: AccountStatus.ACTIVE, deletedAt: null },
    tutorProfile: {
      user: { id: TUTOR_ID, accountStatus: AccountStatus.ACTIVE, deletedAt: null },
    },
    ...overrides,
  };
}

function keyOf(row: BookingRow, band: '24H' | '1H', kind: 'CLASS' | 'PAYMENT'): string {
  return reminderEventKey(
    { id: row.id, slotId: row.slotId, startAtUtc: row.slot.startAtUtc },
    band,
    kind,
  );
}

interface WrittenRow {
  userId: string;
  eventType: string;
  eventKey: string;
  bookingId: string;
}

describe('ReminderJobService (S3-T06)', () => {
  let service: ReminderJobService;
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn(),
    booking: { findUnique: jest.fn() },
    notification: { createMany: jest.fn() },
  };
  const db = {
    booking: { findMany: jest.fn() },
    notification: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  function written(): WrittenRow[] {
    return tx.notification.createMany.mock.calls.flatMap(
      ([args]: [{ data: WrittenRow[] }]) => args.data,
    );
  }

  function writtenPairs(): [string, string][] {
    return written().map(({ userId, eventKey }) => [userId, eventKey]);
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    calls.length = 0;
    db.$transaction.mockImplementation((run: (client: typeof tx) => Promise<unknown>) => run(tx));
    db.booking.findMany.mockResolvedValue([bookingRow()]);
    db.notification.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`${strings.join('?')} ${String(values[0])}`);
      return Promise.resolve([]);
    });
    tx.booking.findUnique.mockImplementation(() => {
      calls.push('read');
      return Promise.resolve(bookingRow());
    });
    tx.notification.createMany.mockImplementation(({ data }: { data: unknown[] }) => {
      calls.push('write');
      return Promise.resolve({ count: data.length });
    });
    const module = await Test.createTestingModule({
      providers: [
        ReminderJobService,
        NotificationEventsService,
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    service = module.get(ReminderJobService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers one UTC job every minute that never overlaps itself and stays off under Jest', () => {
    const tick: unknown = Object.getOwnPropertyDescriptor(
      ReminderJobService.prototype,
      'tick',
    )?.value;
    if (typeof tick !== 'function') throw new Error('Missing tick handler');
    const options: unknown = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, tick);
    expect(options).toMatchObject({
      cronTime: CronExpression.EVERY_MINUTE,
      name: REMINDER_JOB_NAME,
      timeZone: 'UTC',
      waitForCompletion: true,
      disabled: true,
    });
  });

  it('runs with the current time and logs only the error class when a run fails', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const runOnce = jest
      .spyOn(service, 'runOnce')
      .mockRejectedValue(new TypeError(`leaked booking ${BOOKING_ID}`));
    jest.useFakeTimers().setSystemTime(NOW_24H);
    try {
      await expect(service.tick()).resolves.toBeUndefined();
      expect(runOnce).toHaveBeenCalledTimes(1);
      expect(runOnce).toHaveBeenCalledWith(NOW_24H);
    } finally {
      jest.useRealTimers();
    }
    expect(error).toHaveBeenCalledWith('Reminder run failed (TypeError); retrying next tick');
  });

  it('rejects an invalid clock before querying', async () => {
    await expect(service.runOnce(new Date(Number.NaN))).rejects.toThrow(RangeError);
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it('scans only CONFIRMED bookings starting in (now, now + 24h], ordered by start then ID', async () => {
    await service.runOnce(NOW_24H);

    expect(db.booking.findMany).toHaveBeenCalledTimes(1);
    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              status: BookingStatus.CONFIRMED,
              slot: { startAtUtc: { gt: NOW_24H, lte: WINDOW_END } },
            },
          ],
        },
        orderBy: [{ slot: { startAtUtc: 'asc' } }, { id: 'asc' }],
        take: REMINDER_SCAN_PAGE_SIZE,
      }),
    );
  });

  it('pages with a (startAtUtc, id) cursor until a short page', async () => {
    const suspended = { accountStatus: AccountStatus.SUSPENDED, deletedAt: null };
    const rows = Array.from({ length: REMINDER_SCAN_PAGE_SIZE + 1 }, (_, index) =>
      bookingRow({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        student: { id: STUDENT_ID, ...suspended },
        tutorProfile: { user: { id: TUTOR_ID, ...suspended } },
      }),
    );
    db.booking.findMany
      .mockResolvedValueOnce(rows.slice(0, REMINDER_SCAN_PAGE_SIZE))
      .mockResolvedValueOnce(rows.slice(REMINDER_SCAN_PAGE_SIZE));
    const last = rows[REMINDER_SCAN_PAGE_SIZE - 1];

    await expect(service.runOnce(NOW_24H)).resolves.toEqual({
      scanned: REMINDER_SCAN_PAGE_SIZE + 1,
      created: 0,
      duplicates: 0,
      failed: 0,
    });

    expect(db.booking.findMany).toHaveBeenCalledTimes(2);
    expect(db.booking.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              status: BookingStatus.CONFIRMED,
              slot: { startAtUtc: { gt: NOW_24H, lte: WINDOW_END } },
            },
            {
              OR: [
                { slot: { startAtUtc: { gt: START } } },
                { slot: { startAtUtc: START }, id: { gt: last?.id } },
              ],
            },
          ],
        },
      }),
    );
    // Inactive recipients plan nothing, so no booking is locked.
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('locks the booking, re-reads it, then writes only the unpaid student payment reminder', async () => {
    const row = bookingRow();

    await expect(service.runOnce(NOW_24H)).resolves.toEqual({
      scanned: 1,
      created: 1,
      duplicates: 0,
      failed: 0,
    });

    expect(calls).toEqual([
      `SELECT "id" FROM "Booking" WHERE "id" = ?::uuid FOR UPDATE ${BOOKING_ID}`,
      'read',
      'write',
    ]);
    expect(tx.booking.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BOOKING_ID } }),
    );
    expect(writtenPairs()).toEqual([[STUDENT_ID, keyOf(row, '24H', 'PAYMENT')]]);
    expect(written().every(({ bookingId }) => bookingId === BOOKING_ID)).toBe(true);
  });

  it('sends one catch-up 1H band on a late first run, never the missed 24H band', async () => {
    const row = bookingRow();

    await service.runOnce(NOW_LATE);

    expect(writtenPairs()).toEqual([[STUDENT_ID, keyOf(row, '1H', 'PAYMENT')]]);
  });

  it.each([
    [24 * 60 * 60 * 1000 + 1, null],
    [24 * 60 * 60 * 1000, '24H'],
    [24 * 60 * 60 * 1000 - 1, '24H'],
    [2 * 60 * 60 * 1000, '24H'],
    [60 * 60 * 1000 + 1, '24H'],
    [60 * 60 * 1000, '1H'],
    [60 * 60 * 1000 - 1, '1H'],
    [1, '1H'],
    [0, null],
    [-1, null],
  ] as const)('re-plans a scanned row at delta %d ms into %s only', async (delta, band) => {
    // A stale scan must still pass the policy after locking, including the start boundary.
    await service.runOnce(new Date(START.getTime() - delta));
    expect(writtenPairs()).toEqual(
      band ? [[STUDENT_ID, keyOf(bookingRow(), band, 'PAYMENT')]] : [],
    );
  });

  it('drops the payment reminder when the booking was paid after the scan', async () => {
    tx.booking.findUnique.mockResolvedValue(bookingRow({ paymentStatus: PaymentStatus.PAID }));

    await expect(service.runOnce(NOW_24H)).resolves.toMatchObject({ created: 2 });

    expect(written().map(({ eventType }) => eventType)).toEqual([
      'CLASS_REMINDER_24H',
      'CLASS_REMINDER_24H',
    ]);
  });

  it('sends both class reminders after payment even when the same-band payment reminder exists', async () => {
    const paid = bookingRow({ paymentStatus: PaymentStatus.PAID });
    db.booking.findMany.mockResolvedValue([paid]);
    tx.booking.findUnique.mockResolvedValue(paid);
    db.notification.findMany.mockResolvedValue([
      { userId: STUDENT_ID, eventKey: keyOf(paid, '24H', 'PAYMENT') },
    ]);

    await expect(service.runOnce(NOW_24H)).resolves.toMatchObject({ created: 2 });
    expect(writtenPairs()).toEqual([
      [STUDENT_ID, keyOf(paid, '24H', 'CLASS')],
      [TUTOR_ID, keyOf(paid, '24H', 'CLASS')],
    ]);
  });

  it.each([
    ['canceled', bookingRow({ status: BookingStatus.CANCELED })],
    ['deleted', null],
  ])('writes nothing when the booking was %s after the scan', async (_state, locked) => {
    tx.booking.findUnique.mockResolvedValue(locked);

    await expect(service.runOnce(NOW_24H)).resolves.toEqual({
      scanned: 1,
      created: 0,
      duplicates: 0,
      failed: 0,
    });
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('keys reminders to the locked slot when the booking was rescheduled after the scan', async () => {
    const rescheduled = bookingRow({
      slotId: RESCHEDULED_SLOT_ID,
      slot: { startAtUtc: new Date('2026-11-09T11:45:00.000Z') },
    });
    tx.booking.findUnique.mockResolvedValue(rescheduled);

    await service.runOnce(NOW_24H);

    expect(writtenPairs()).toEqual([[STUDENT_ID, keyOf(rescheduled, '1H', 'PAYMENT')]]);
  });

  it('writes nothing when a reschedule moved the class out of the window after the scan', async () => {
    tx.booking.findUnique.mockResolvedValue(
      bookingRow({
        slotId: RESCHEDULED_SLOT_ID,
        slot: { startAtUtc: new Date('2026-11-12T11:00:00.000Z') },
      }),
    );

    await service.runOnce(NOW_24H);

    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('skips a recipient whose account was suspended after the scan', async () => {
    tx.booking.findUnique.mockResolvedValue(
      bookingRow({
        student: { id: STUDENT_ID, accountStatus: AccountStatus.SUSPENDED, deletedAt: null },
      }),
    );

    await service.runOnce(NOW_24H);

    expect(writtenPairs()).toEqual([]);
  });

  it('skips the lock entirely when every planned reminder is already stored', async () => {
    const row = bookingRow();
    db.notification.findMany.mockResolvedValue([
      { userId: STUDENT_ID, eventKey: keyOf(row, '24H', 'CLASS') },
      { userId: TUTOR_ID, eventKey: keyOf(row, '24H', 'CLASS') },
      { userId: STUDENT_ID, eventKey: keyOf(row, '24H', 'PAYMENT') },
    ]);

    await expect(service.runOnce(NOW_24H)).resolves.toEqual({
      scanned: 1,
      created: 0,
      duplicates: 1,
      failed: 0,
    });

    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: { bookingId: { in: [BOOKING_ID] }, eventKey: { startsWith: 'reminder:' } },
      select: { userId: true, eventKey: true },
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('locks and lets the unique index skip duplicates when only some reminders are stored', async () => {
    db.booking.findMany.mockResolvedValue([bookingRow({ paymentStatus: PaymentStatus.PAID })]);
    tx.booking.findUnique.mockResolvedValue(bookingRow({ paymentStatus: PaymentStatus.PAID }));
    db.notification.findMany.mockResolvedValue([
      { userId: STUDENT_ID, eventKey: keyOf(bookingRow(), '24H', 'CLASS') },
    ]);
    tx.notification.createMany.mockResolvedValue({ count: 1 });

    await expect(service.runOnce(NOW_24H)).resolves.toEqual({
      scanned: 1,
      created: 1,
      duplicates: 1,
      failed: 0,
    });
    expect(tx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('counts a failed booking, carries on with the next, and logs only the error class', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    db.booking.findMany.mockResolvedValue([bookingRow(), bookingRow({ id: SECOND_BOOKING_ID })]);
    tx.booking.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(bookingRow({ id: where.id })),
    );
    db.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(`lock timeout on ${BOOKING_ID}`, {
        code: 'P2010',
        clientVersion: '7.10.0',
      }),
    );

    await expect(service.runOnce(NOW_24H)).resolves.toEqual({
      scanned: 2,
      created: 1,
      duplicates: 0,
      failed: 1,
    });

    expect(written().every(({ bookingId }) => bookingId === SECOND_BOOKING_ID)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'Reminder booking skipped (PrismaClientKnownRequestError/P2010); retrying next tick',
    );
    expect(log).toHaveBeenCalledWith('Reminder run: scanned=2 created=1 duplicates=0 failed=1');
    const logged = [...warn.mock.calls, ...log.mock.calls].flat().join(' ');
    expect(logged).not.toContain(BOOKING_ID);
    expect(logged).not.toContain(STUDENT_ID);
  });

  it('stays quiet when a run has nothing new to report', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    db.booking.findMany.mockResolvedValue([]);

    await expect(service.runOnce(NOW_24H)).resolves.toEqual({
      scanned: 0,
      created: 0,
      duplicates: 0,
      failed: 0,
    });
    expect(db.notification.findMany).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('aborts the run for the next tick when the scan itself fails', async () => {
    const error = new Error('Database unavailable');
    db.booking.findMany.mockRejectedValue(error);

    await expect(service.runOnce(NOW_24H)).rejects.toBe(error);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

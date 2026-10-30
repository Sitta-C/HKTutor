import { AccountStatus, BookingStatus, PaymentStatus } from '@generated/prisma/client';
import {
  planReminders,
  reminderEventKey,
  selectReminderBand,
} from '@modules/notifications/reminder-policy';

import type {
  ReminderBand,
  ReminderBooking,
  ReminderEventType,
  ReminderRecipient,
} from '@modules/notifications/reminder-policy';

// S3-T05 acceptance fixtures: the approved 2026-10-26 reminder truth table. Times are stored and
// compared in UTC; the Asia/Bangkok values are for display and are checked against the UTC ones.

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const RESCHEDULED_SLOT_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const TUTOR_ID = '55555555-5555-4555-8555-555555555555';

const START = '2026-11-10T11:00:00.000Z';
const START_BANGKOK = '2026-11-10 18:00:00.000';
const MIDNIGHT_START = '2026-11-10T17:00:00.000Z';
const MIDNIGHT_START_BANGKOK = '2026-11-11 00:00:00.000';
const RESCHEDULED_START = '2026-11-11T11:00:00.000Z';

interface ReminderBandCase {
  name: string;
  startAtUtc: string;
  nowUtc: string;
  bangkok: { startAt: string; now: string };
  expected: ReminderBand | null;
}

const REMINDER_BAND_CASES: ReminderBandCase[] = [
  {
    name: '24h + 1ms before start selects nothing',
    startAtUtc: START,
    nowUtc: '2026-11-09T10:59:59.999Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-09 17:59:59.999' },
    expected: null,
  },
  {
    name: 'exactly 24h before start selects 24H',
    startAtUtc: START,
    nowUtc: '2026-11-09T11:00:00.000Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-09 18:00:00.000' },
    expected: '24H',
  },
  {
    name: '24h - 1ms before start selects 24H',
    startAtUtc: START,
    nowUtc: '2026-11-09T11:00:00.001Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-09 18:00:00.001' },
    expected: '24H',
  },
  {
    name: 'a first run 2h before start sends the 24H catch-up',
    startAtUtc: START,
    nowUtc: '2026-11-10T09:00:00.000Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-10 16:00:00.000' },
    expected: '24H',
  },
  {
    name: '1h + 1ms before start still selects 24H',
    startAtUtc: START,
    nowUtc: '2026-11-10T09:59:59.999Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-10 16:59:59.999' },
    expected: '24H',
  },
  {
    name: 'exactly 1h before start selects only 1H',
    startAtUtc: START,
    nowUtc: '2026-11-10T10:00:00.000Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-10 17:00:00.000' },
    expected: '1H',
  },
  {
    name: '1h - 1ms before start selects 1H',
    startAtUtc: START,
    nowUtc: '2026-11-10T10:00:00.001Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-10 17:00:00.001' },
    expected: '1H',
  },
  {
    name: 'a delayed run 30m before start selects 1H',
    startAtUtc: START,
    nowUtc: '2026-11-10T10:30:00.000Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-10 17:30:00.000' },
    expected: '1H',
  },
  {
    name: '1ms before start selects 1H',
    startAtUtc: START,
    nowUtc: '2026-11-10T10:59:59.999Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-10 17:59:59.999' },
    expected: '1H',
  },
  {
    name: 'exactly at start selects nothing',
    startAtUtc: START,
    nowUtc: START,
    bangkok: { startAt: START_BANGKOK, now: START_BANGKOK },
    expected: null,
  },
  {
    name: '1ms after start selects nothing',
    startAtUtc: START,
    nowUtc: '2026-11-10T11:00:00.001Z',
    bangkok: { startAt: START_BANGKOK, now: '2026-11-10 18:00:00.001' },
    expected: null,
  },
  {
    name: 'a class at Bangkok midnight selects 24H at the previous Bangkok midnight',
    startAtUtc: MIDNIGHT_START,
    nowUtc: '2026-11-09T17:00:00.000Z',
    bangkok: { startAt: MIDNIGHT_START_BANGKOK, now: '2026-11-10 00:00:00.000' },
    expected: '24H',
  },
  {
    name: 'a class at Bangkok midnight selects 1H at 23:00 Bangkok the day before',
    startAtUtc: MIDNIGHT_START,
    nowUtc: '2026-11-10T16:00:00.000Z',
    bangkok: { startAt: MIDNIGHT_START_BANGKOK, now: '2026-11-10 23:00:00.000' },
    expected: '1H',
  },
];

interface BookingOverrides {
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  slotId?: string;
  startAtUtc?: string;
  student?: Partial<ReminderRecipient>;
  tutor?: Partial<ReminderRecipient>;
}

function reminderBooking(overrides: BookingOverrides = {}): ReminderBooking {
  const recipient = (userId: string, changes: Partial<ReminderRecipient> = {}) => ({
    userId,
    accountStatus: AccountStatus.ACTIVE,
    deletedAt: null,
    ...changes,
  });
  return {
    id: BOOKING_ID,
    slotId: overrides.slotId ?? SLOT_ID,
    startAtUtc: new Date(overrides.startAtUtc ?? START),
    status: overrides.status ?? BookingStatus.CONFIRMED,
    paymentStatus: overrides.paymentStatus ?? PaymentStatus.UNPAID,
    student: recipient(STUDENT_ID, overrides.student),
    tutor: recipient(TUTOR_ID, overrides.tutor),
  };
}

interface ExpectedReminder {
  userId: string;
  eventType: ReminderEventType;
  eventKey: string;
}

interface ReminderRecipientCase {
  name: string;
  nowUtc: string;
  booking: BookingOverrides;
  expected: ExpectedReminder[];
}

const RUN_24H = '2026-11-10T09:00:00.000Z';
const RUN_1H = '2026-11-10T10:30:00.000Z';
const key = (band: ReminderBand, kind: 'CLASS' | 'PAYMENT', slotId = SLOT_ID, start = START) =>
  `reminder:${BOOKING_ID}:${slotId}:${start}:${band}:${kind}`;

const REMINDER_RECIPIENT_CASES: ReminderRecipientCase[] = [
  {
    name: 'confirmed and unpaid: class reminder for both, payment reminder for the student',
    nowUtc: RUN_24H,
    booking: {},
    expected: [
      { userId: STUDENT_ID, eventType: 'CLASS_REMINDER_24H', eventKey: key('24H', 'CLASS') },
      { userId: TUTOR_ID, eventType: 'CLASS_REMINDER_24H', eventKey: key('24H', 'CLASS') },
      { userId: STUDENT_ID, eventType: 'PAYMENT_REMINDER_24H', eventKey: key('24H', 'PAYMENT') },
    ],
  },
  {
    name: 'confirmed and unpaid in the 1H band',
    nowUtc: RUN_1H,
    booking: {},
    expected: [
      { userId: STUDENT_ID, eventType: 'CLASS_REMINDER_1H', eventKey: key('1H', 'CLASS') },
      { userId: TUTOR_ID, eventType: 'CLASS_REMINDER_1H', eventKey: key('1H', 'CLASS') },
      { userId: STUDENT_ID, eventType: 'PAYMENT_REMINDER_1H', eventKey: key('1H', 'PAYMENT') },
    ],
  },
  {
    name: 'confirmed and paid: class reminder for both, no payment reminder',
    nowUtc: RUN_24H,
    booking: { paymentStatus: PaymentStatus.PAID },
    expected: [
      { userId: STUDENT_ID, eventType: 'CLASS_REMINDER_24H', eventKey: key('24H', 'CLASS') },
      { userId: TUTOR_ID, eventType: 'CLASS_REMINDER_24H', eventKey: key('24H', 'CLASS') },
    ],
  },
  ...[
    BookingStatus.PENDING,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELED,
    BookingStatus.EXPIRED,
  ].map((status) => ({
    name: `${status.toLowerCase()} booking gets no reminders`,
    nowUtc: RUN_24H,
    booking: { status },
    expected: [],
  })),
  {
    name: 'a suspended tutor is skipped; the student still gets both reminders',
    nowUtc: RUN_24H,
    booking: { tutor: { accountStatus: AccountStatus.SUSPENDED } },
    expected: [
      { userId: STUDENT_ID, eventType: 'CLASS_REMINDER_24H', eventKey: key('24H', 'CLASS') },
      { userId: STUDENT_ID, eventType: 'PAYMENT_REMINDER_24H', eventKey: key('24H', 'PAYMENT') },
    ],
  },
  {
    name: 'a deleted student is skipped, including the payment reminder',
    nowUtc: RUN_24H,
    booking: {
      student: {
        accountStatus: AccountStatus.DELETED,
        deletedAt: new Date('2026-11-01T00:00:00Z'),
      },
    },
    expected: [
      { userId: TUTOR_ID, eventType: 'CLASS_REMINDER_24H', eventKey: key('24H', 'CLASS') },
    ],
  },
  {
    name: 'a confirmed booking outside both windows gets no reminders',
    nowUtc: '2026-11-09T10:00:00.000Z',
    booking: {},
    expected: [],
  },
  {
    name: 'a rescheduled booking uses the new slot and start time in its keys',
    nowUtc: '2026-11-11T09:00:00.000Z',
    booking: { slotId: RESCHEDULED_SLOT_ID, startAtUtc: RESCHEDULED_START },
    expected: [
      {
        userId: STUDENT_ID,
        eventType: 'CLASS_REMINDER_24H',
        eventKey: key('24H', 'CLASS', RESCHEDULED_SLOT_ID, RESCHEDULED_START),
      },
      {
        userId: TUTOR_ID,
        eventType: 'CLASS_REMINDER_24H',
        eventKey: key('24H', 'CLASS', RESCHEDULED_SLOT_ID, RESCHEDULED_START),
      },
      {
        userId: STUDENT_ID,
        eventType: 'PAYMENT_REMINDER_24H',
        eventKey: key('24H', 'PAYMENT', RESCHEDULED_SLOT_ID, RESCHEDULED_START),
      },
    ],
  },
];

const MINUTE_MS = 60 * 1000;
const KEY_FORMAT =
  /^reminder:[0-9a-f-]{36}:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z:(24H|1H):(CLASS|PAYMENT)$/;

const bangkokFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});

function bangkok(utc: string): string {
  const part = Object.fromEntries(
    bangkokFormat.formatToParts(new Date(utc)).map(({ type, value }) => [type, value]),
  );
  return `${part['year']}-${part['month']}-${part['day']} ${part['hour']}:${part['minute']}:${part['second']}.${part['fractionalSecond']}`;
}

describe('reminder policy (S3-T05 truth table)', () => {
  it.each(REMINDER_BAND_CASES)('$name', ({ startAtUtc, nowUtc, expected }) => {
    expect(selectReminderBand(new Date(startAtUtc), new Date(nowUtc))).toBe(expected);
  });

  it.each(REMINDER_BAND_CASES)('shows the Asia/Bangkok times for: $name', (testCase) => {
    expect(bangkok(testCase.startAtUtc)).toBe(testCase.bangkok.startAt);
    expect(bangkok(testCase.nowUtc)).toBe(testCase.bangkok.now);
  });

  it.each(REMINDER_RECIPIENT_CASES)('$name', ({ nowUtc, booking, expected }) => {
    expect(planReminders(reminderBooking(booking), new Date(nowUtc))).toEqual(expected);
  });

  it('moves from none to 24H to 1H to none exactly at the boundaries, one band per run', () => {
    const start = new Date('2026-11-10T11:00:00.000Z');
    const changes: { minutesBeforeStart: number; band: string }[] = [];
    let previous: string | undefined;
    for (let minutes = 25 * 60; minutes >= -60; minutes--) {
      const now = new Date(start.getTime() - minutes * MINUTE_MS);
      const band = selectReminderBand(start, now) ?? 'none';
      const bands = new Set(
        planReminders(reminderBooking(), now).map(({ eventType }) => eventType.split('_').pop()),
      );
      expect(bands.size).toBeLessThanOrEqual(1);
      if (band !== previous) {
        changes.push({ minutesBeforeStart: minutes, band });
        previous = band;
      }
    }
    expect(changes).toEqual([
      { minutesBeforeStart: 25 * 60, band: 'none' },
      { minutesBeforeStart: 24 * 60, band: '24H' },
      { minutesBeforeStart: 60, band: '1H' },
      { minutesBeforeStart: 0, band: 'none' },
    ]);
  });

  it('builds every event key in the documented format', () => {
    const keys = REMINDER_RECIPIENT_CASES.flatMap(({ nowUtc, booking }) =>
      planReminders(reminderBooking(booking), new Date(nowUtc)).map(({ eventKey }) => eventKey),
    );
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(KEY_FORMAT);
    }
  });

  it('keeps a rescheduled occurrence apart from the original slot', () => {
    const original = reminderBooking();
    const rescheduled = reminderBooking({
      slotId: RESCHEDULED_SLOT_ID,
      startAtUtc: '2026-11-11T11:00:00.000Z',
    });
    for (const band of ['24H', '1H'] as const) {
      for (const kind of ['CLASS', 'PAYMENT'] as const) {
        expect(reminderEventKey(rescheduled, band, kind)).not.toBe(
          reminderEventKey(original, band, kind),
        );
      }
    }
  });

  it('keeps bands and kinds apart for the same booking', () => {
    const booking = reminderBooking();
    const keys = (['24H', '1H'] as const).flatMap((band) =>
      (['CLASS', 'PAYMENT'] as const).map((kind) => reminderEventKey(booking, band, kind)),
    );
    expect(new Set(keys).size).toBe(4);
  });

  it('rejects invalid dates instead of choosing a band', () => {
    const valid = new Date('2026-11-10T11:00:00.000Z');
    const invalid = new Date('not a date');
    expect(() => selectReminderBand(invalid, valid)).toThrow(RangeError);
    expect(() => selectReminderBand(valid, invalid)).toThrow(RangeError);
    expect(() => planReminders(reminderBooking(), invalid)).toThrow(RangeError);
  });
});

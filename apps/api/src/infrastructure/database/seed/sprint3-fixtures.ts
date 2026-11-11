import {
  BookingStatus,
  CouponReservationStatus,
  PaymentAttemptStatus,
} from '@generated/prisma/client';

export const SPRINT3_FIXTURE_NOW = new Date('2030-12-31T17:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Separate UUID namespace from earlier sprint seeds; never use these IDs for real accounts. */
export function sprint3FixtureId(index: number): string {
  return `db040000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

export const SPRINT3_IDS = {
  student: sprint3FixtureId(1),
  otherStudent: sprint3FixtureId(2),
  raceStudent: sprint3FixtureId(5),
  inactiveStudent: sprint3FixtureId(3),
  deletedStudent: sprint3FixtureId(4),
  subject: sprint3FixtureId(10),
  grade: sprint3FixtureId(11),
  tutors: {
    report905: sprint3FixtureId(100),
    reportExpired: sprint3FixtureId(101),
    reportUnfinalized: sprint3FixtureId(102),
    reportEmpty: sprint3FixtureId(103),
    review433: sprint3FixtureId(104),
    review400: sprint3FixtureId(105),
    review100: sprint3FixtureId(106),
    review500: sprint3FixtureId(107),
    newTutor: sprint3FixtureId(108),
    coupons: sprint3FixtureId(109),
    reminders: sprint3FixtureId(110),
  },
} as const;

export interface Sprint3CouponFixture {
  id: string;
  key: string;
  code: string;
  percent: number;
  maxUses: number;
  active: boolean;
  expiresAt: Date;
}

export interface Sprint3ClassFixture {
  key: string;
  group: keyof typeof SPRINT3_IDS.tutors;
  id: string;
  slotId: string;
  reviewId: string;
  attemptId: string;
  reservationId: string;
  studentId: string;
  tutorId: string;
  startAtUtc: Date;
  status: BookingStatus;
  paid: boolean;
  subtotal: string;
  discount: string;
  net: string;
  couponKey?: string;
  scores?: readonly [number, number, number];
  attemptStatus?: PaymentAttemptStatus;
  reservationStatus?: CouponReservationStatus;
}

export interface Sprint3ReminderFixture {
  key: string;
  bookingId: string;
  now: Date;
  expectedBand: '24H' | '1H' | null;
  expectedRecipients: number;
}

/** Pure inputs: unit tests can import this without connecting to a database or loading .env. */
export function buildSprint3Fixtures(now: Date = SPRINT3_FIXTURE_NOW): {
  now: Date;
  coupons: Sprint3CouponFixture[];
  classes: Sprint3ClassFixture[];
  reminders: Sprint3ReminderFixture[];
} {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('Fixture now must be a valid date');
  }
  const at = (offset: number): Date => new Date(now.getTime() + offset);
  const classes: Sprint3ClassFixture[] = [];
  const add = (
    key: string,
    group: Sprint3ClassFixture['group'],
    input: Partial<Sprint3ClassFixture> = {},
  ): Sprint3ClassFixture => {
    // Append new cases at the end: existing positions are persisted operation IDs.
    const index = classes.length;
    const fixture: Sprint3ClassFixture = {
      key,
      group,
      id: sprint3FixtureId(1000 + index),
      slotId: sprint3FixtureId(2000 + index),
      reviewId: sprint3FixtureId(3000 + index),
      attemptId: sprint3FixtureId(4000 + index),
      reservationId: sprint3FixtureId(5000 + index),
      studentId: SPRINT3_IDS.student,
      tutorId: SPRINT3_IDS.tutors[group],
      startAtUtc:
        group === 'coupons'
          ? at((1 + classes.filter((row) => row.group === 'coupons').length * 2) * HOUR)
          : at(-(100 + index * 2) * DAY),
      status: BookingStatus.CONFIRMED,
      paid: false,
      subtotal: '450.00',
      discount: '0.00',
      net: '450.00',
      ...input,
    };
    classes.push(fixture);
    return fixture;
  };

  for (let index = 0; index < 12; index += 1) {
    add(`report-${index + 1}`, 'report905', {
      status:
        index < 6
          ? BookingStatus.COMPLETED
          : index < 8
            ? BookingStatus.CANCELED
            : index < 11
              ? BookingStatus.PENDING
              : BookingStatus.CONFIRMED,
      paid: index < 2,
      subtotal: index === 1 ? '500.00' : '450.00',
      discount: index === 0 ? '45.00' : '0.00',
      net: index === 0 ? '405.00' : index === 1 ? '500.00' : '450.00',
      ...(index === 0
        ? {
            couponKey: 'welcome10',
            attemptStatus: PaymentAttemptStatus.SUCCESSFUL,
            reservationStatus: CouponReservationStatus.CONSUMED,
          }
        : {}),
    });
  }
  add('report-expired', 'reportExpired', { status: BookingStatus.EXPIRED });
  add('report-unfinalized', 'reportUnfinalized');
  add('review-545', 'review433', {
    status: BookingStatus.COMPLETED,
    paid: true,
    scores: [5, 4, 5],
  });
  add('review-444', 'review433', {
    status: BookingStatus.COMPLETED,
    paid: true,
    scores: [4, 4, 4],
  });
  for (const [group, score] of [
    ['review400', 4],
    ['review100', 1],
    ['review500', 5],
  ] as const) {
    add(group, group, {
      status: BookingStatus.COMPLETED,
      paid: true,
      scores: [score, score, score],
    });
  }

  const couponInputs = [
    ['welcome10', 'WELCOME10', 10, 20, true, DAY],
    ['free100', 'DB04_FREE100', 100, 5, true, DAY],
    ['inactive', 'DB04_INACTIVE', 10, 5, false, DAY],
    ['expired', 'DB04_EXPIRED', 10, 5, true, -1],
    ['expiresNow', 'DB04_EXPIRES_NOW', 10, 5, true, 0],
    ['expiresNext', 'DB04_EXPIRES_NEXT', 10, 5, true, 1],
    ['exhausted', 'DB04_EXHAUSTED', 10, 1, true, DAY],
    ['lastUse', 'DB04_LAST_USE', 10, 2, true, DAY],
  ] as const;
  const coupons: Sprint3CouponFixture[] = couponInputs.map(
    ([key, code, percent, maxUses, active, expiry], index) => ({
      id: sprint3FixtureId(20 + index),
      key,
      code,
      percent,
      maxUses,
      active,
      expiresAt: at(expiry),
    }),
  );
  add('free-settled', 'coupons', {
    couponKey: 'free100',
    discount: '450.00',
    net: '0.00',
    paid: true,
    reservationStatus: CouponReservationStatus.CONSUMED,
  });
  add('free-ready', 'coupons', {
    couponKey: 'free100',
    discount: '450.00',
    net: '0.00',
    studentId: SPRINT3_IDS.otherStudent,
  });
  for (const couponKey of ['exhausted', 'lastUse']) {
    add(`${couponKey}-used`, 'coupons', {
      couponKey,
      discount: '45.00',
      net: '405.00',
      paid: true,
      attemptStatus: PaymentAttemptStatus.SUCCESSFUL,
      reservationStatus: CouponReservationStatus.CONSUMED,
    });
  }
  for (const [key, studentId] of [
    ['last-use-a', SPRINT3_IDS.otherStudent],
    ['last-use-b', SPRINT3_IDS.raceStudent],
  ] as const) {
    add(key, 'coupons', { studentId, couponKey: 'lastUse', discount: '45.00', net: '405.00' });
  }
  add('same-student-reuse', 'coupons', { couponKey: 'lastUse', discount: '45.00', net: '405.00' });
  for (const [key, attemptStatus, reservationStatus] of [
    ['active', PaymentAttemptStatus.PENDING, CouponReservationStatus.RESERVED],
    ['uncertain', PaymentAttemptStatus.CREATING, CouponReservationStatus.RESERVED],
    ['released-failed', PaymentAttemptStatus.FAILED, CouponReservationStatus.RELEASED],
    ['released-expired', PaymentAttemptStatus.EXPIRED, CouponReservationStatus.RELEASED],
  ] as const) {
    const couponKey = key;
    coupons.push({
      id: sprint3FixtureId(30 + coupons.length),
      key,
      code: `DB04_${key.replaceAll('-', '_').toUpperCase()}`,
      percent: 10,
      maxUses: 2,
      active: true,
      expiresAt: at(DAY),
    });
    add(key, 'coupons', {
      couponKey,
      discount: '45.00',
      net: '405.00',
      attemptStatus,
      reservationStatus,
    });
  }
  add('below-provider-minimum', 'coupons', {
    couponKey: 'welcome10',
    subtotal: '20.00',
    discount: '2.00',
    net: '18.00',
    studentId: SPRINT3_IDS.otherStudent,
  });

  const reminders: Sprint3ReminderFixture[] = [];
  const boundaries = [
    ['24h-plus-1ms', 24 * HOUR + 1, null],
    ['24h', 24 * HOUR, '24H'],
    ['24h-minus-1ms', 24 * HOUR - 1, '24H'],
    ['1h-plus-1ms', HOUR + 1, '24H'],
    ['1h', HOUR, '1H'],
    ['1h-minus-1ms', HOUR - 1, '1H'],
    ['start-minus-1ms', 1, '1H'],
    ['start', 0, null],
    ['start-plus-1ms', -1, null],
    ['late-first-run-2h', 2 * HOUR, '24H'],
  ] as const;
  const addReminder = (
    key: string,
    delta: number,
    band: Sprint3ReminderFixture['expectedBand'],
    count: number,
    input: Partial<Sprint3ClassFixture> = {},
  ): void => {
    // Three-day spacing isolates runOnce scans and avoids tutor-slot overlap between scenarios.
    const startAtUtc = at((10 + reminders.length * 3) * DAY);
    const fixture = add(key, 'reminders', { startAtUtc, ...input });
    reminders.push({
      key,
      bookingId: fixture.id,
      now: new Date(startAtUtc.getTime() - delta),
      expectedBand: band,
      expectedRecipients: count,
    });
  };
  for (const [key, delta, band] of boundaries) {
    for (const paid of [false, true]) {
      addReminder(
        `${key}-${paid ? 'paid' : 'unpaid'}`,
        delta,
        band,
        band === null ? 0 : paid ? 2 : 3,
        { paid },
      );
    }
  }
  for (const status of [
    BookingStatus.CANCELED,
    BookingStatus.PENDING,
    BookingStatus.COMPLETED,
    BookingStatus.EXPIRED,
  ]) {
    addReminder(`skip-${status.toLowerCase()}`, HOUR, null, 0, { status });
  }
  addReminder('inactive-student', HOUR, '1H', 1, { studentId: SPRINT3_IDS.inactiveStudent });
  addReminder('deleted-student', HOUR, '1H', 1, { studentId: SPRINT3_IDS.deletedStudent });
  addReminder('payment-pending', HOUR, '1H', 3, { attemptStatus: PaymentAttemptStatus.PENDING });
  addReminder('rescheduled', HOUR, '1H', 3);
  addReminder('bangkok-year-midnight', HOUR, '1H', 3, { startAtUtc: at(365 * DAY) });
  // Preserve midnight start for the explicit cross-year case, independent of the isolation offset.
  const midnight = reminders.at(-1);
  if (midnight) {
    midnight.now = at(365 * DAY - HOUR);
  }
  add('coupon-unapplied', 'coupons', { studentId: SPRINT3_IDS.otherStudent });
  return { now: new Date(now), coupons, classes, reminders };
}

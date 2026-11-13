import { AccountStatus, PaymentStatus } from '@generated/prisma/client';
import {
  buildSprint3Fixtures,
  SPRINT3_FIXTURE_NOW,
  SPRINT3_IDS,
} from '@infrastructure/database/seed/sprint3-fixtures';
import { planReminders } from '@modules/notifications/reminder-policy';

describe('Sprint 3 fixture inputs', () => {
  it('reproduces the independent 12-booking report example', () => {
    const fixtures = buildSprint3Fixtures(SPRINT3_FIXTURE_NOW);
    const ledger = fixtures.classes.filter((row) => row.group === 'report905');
    expect(ledger).toHaveLength(12);
    expect(ledger.map((row) => row.status)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'CANCELED',
      'CANCELED',
      'PENDING',
      'PENDING',
      'PENDING',
      'CONFIRMED',
    ]);
    expect(ledger.filter((row) => row.paid).map((row) => row.net)).toEqual(['405.00', '500.00']);
  });

  it('returns independent copies with stable IDs and shifts every scenario with injected now', () => {
    const first = buildSprint3Fixtures();
    const later = buildSprint3Fixtures(new Date(SPRINT3_FIXTURE_NOW.getTime() + 86400000));
    expect(later.classes.map((row) => row.id)).toEqual(first.classes.map((row) => row.id));
    for (const [index, row] of later.classes.entries()) {
      expect(row.startAtUtc.getTime() - (first.classes[index]?.startAtUtc.getTime() ?? NaN)).toBe(
        86400000,
      );
    }
    first.classes[0]?.startAtUtc.setUTCFullYear(1999);
    expect(buildSprint3Fixtures().classes[0]?.startAtUtc.getUTCFullYear()).toBe(2030);
    expect(() => buildSprint3Fixtures(new Date('invalid'))).toThrow(RangeError);
  });

  it('supplies exact review examples without mixing their tutors', () => {
    const rows = buildSprint3Fixtures().classes;
    expect(rows.filter((row) => row.group === 'review433').map((row) => row.scores)).toEqual([
      [5, 4, 5],
      [4, 4, 4],
    ]);
    expect(rows.filter((row) => row.group === 'review100').map((row) => row.scores)).toEqual([
      [1, 1, 1],
    ]);
    expect(rows.filter((row) => row.group === 'review500').map((row) => row.scores)).toEqual([
      [5, 5, 5],
    ]);
    expect(rows.some((row) => row.group === 'newTutor')).toBe(false);
  });

  it('covers coupon state, expiry and settlement inputs without connecting to Omise', () => {
    const { coupons, classes } = buildSprint3Fixtures();
    expect(
      classes
        .filter((row) => row.group === 'coupons')
        .every((row) => row.startAtUtc > SPRINT3_FIXTURE_NOW),
    ).toBe(true);
    expect(
      coupons
        .slice(0, 8)
        .map((row) => [
          row.key,
          row.percent,
          row.maxUses,
          row.active,
          row.expiresAt.getTime() - SPRINT3_FIXTURE_NOW.getTime(),
        ]),
    ).toEqual([
      ['welcome10', 10, 20, true, 86400000],
      ['free100', 100, 5, true, 86400000],
      ['inactive', 10, 5, false, 86400000],
      ['expired', 10, 5, true, -1],
      ['expiresNow', 10, 5, true, 0],
      ['expiresNext', 10, 5, true, 1],
      ['exhausted', 10, 1, true, 86400000],
      ['lastUse', 10, 2, true, 86400000],
    ]);
    expect(classes.find((row) => row.key === 'free-settled')).toMatchObject({
      net: '0.00',
      discount: '450.00',
      paid: true,
      reservationStatus: 'CONSUMED',
    });
    const racers = classes.filter((row) => row.key.startsWith('last-use-'));
    expect(racers).toHaveLength(2);
    expect(new Set(racers.map((row) => row.studentId)).size).toBe(2);
    expect(racers.every((row) => row.studentId !== SPRINT3_IDS.inactiveStudent)).toBe(true);
    expect(classes.find((row) => row.key === 'uncertain')).toMatchObject({
      attemptStatus: 'CREATING',
      reservationStatus: 'RESERVED',
    });
    expect(classes.find((row) => row.key === 'below-provider-minimum')).toMatchObject({
      net: '18.00',
    });
    expect(
      classes.find((row) => row.key === 'below-provider-minimum')?.attemptStatus,
    ).toBeUndefined();
  });

  it('exercises the real reminder policy at every documented boundary and recipient state', () => {
    const { classes, reminders } = buildSprint3Fixtures();
    expect(
      reminders
        .slice(0, 20)
        .filter((_, index) => index % 2 === 0)
        .map((row) => row.expectedBand),
    ).toEqual([null, '24H', '24H', '24H', '1H', '1H', '1H', null, null, '24H']);
    for (const scenario of reminders) {
      const fixture = classes.find((row) => row.id === scenario.bookingId);
      if (!fixture) {
        throw new Error('Missing reminder fixture');
      }
      const inactive = fixture.studentId === SPRINT3_IDS.inactiveStudent;
      const deleted = fixture.studentId === SPRINT3_IDS.deletedStudent;
      const planned = planReminders(
        {
          id: fixture.id,
          slotId: fixture.slotId,
          startAtUtc: fixture.startAtUtc,
          status: fixture.status,
          paymentStatus: fixture.paid ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          student: {
            userId: fixture.studentId,
            accountStatus: inactive
              ? AccountStatus.SUSPENDED
              : deleted
                ? AccountStatus.DELETED
                : AccountStatus.ACTIVE,
            deletedAt: deleted ? SPRINT3_FIXTURE_NOW : null,
          },
          tutor: { userId: fixture.tutorId, accountStatus: AccountStatus.ACTIVE, deletedAt: null },
        },
        scenario.now,
      );
      expect(planned).toHaveLength(scenario.expectedRecipients);
      expect(planned.every((row) => row.eventType.endsWith(`_${scenario.expectedBand}`))).toBe(
        true,
      );
      expect(
        planned.filter((row) => row.eventType.startsWith('PAYMENT')).map((row) => row.userId),
      ).toEqual(!fixture.paid && scenario.expectedRecipients > 0 ? [fixture.studentId] : []);
    }
  });
});

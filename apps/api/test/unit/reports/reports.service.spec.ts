import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { buildSprint3Fixtures, SPRINT3_IDS } from '@infrastructure/database/seed/sprint3-fixtures';
import { ReportsService } from '@modules/reports/reports.service';

const TUTOR_A = '20000000-0000-4000-8000-000000000001';
const TUTOR_B = '20000000-0000-4000-8000-000000000002';

interface SimulatedBookingRow {
  tutorProfileId: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  netAmount: Prisma.Decimal;
  listingArchivedOrDeleted?: boolean;
  paymentMethod?: 'COUPON_ZERO' | 'LEGACY_MOCK' | 'PROMPTPAY' | 'NONE';
}

function wireSimulatedBookings(
  db: {
    booking: { aggregate: jest.Mock; groupBy: jest.Mock };
    $transaction: jest.Mock;
  },
  rows: readonly SimulatedBookingRow[],
): void {
  db.booking.groupBy.mockImplementation(({ where }: { where: { tutorProfileId: string } }) => {
    const owned = rows.filter((row) => row.tutorProfileId === where.tutorProfileId);
    const counts = new Map<BookingStatus, number>();
    for (const row of owned) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return Promise.resolve(
      [...counts.entries()].map(([status, count]) => ({
        _count: { _all: count },
        status,
      })),
    );
  });

  db.booking.aggregate.mockImplementation(
    ({
      where,
    }: {
      where: {
        tutorProfileId: string;
        status: BookingStatus;
        paymentStatus: PaymentStatus;
      };
    }) => {
      const matching = rows.filter(
        (row) =>
          row.tutorProfileId === where.tutorProfileId &&
          row.status === where.status &&
          row.paymentStatus === where.paymentStatus,
      );
      if (matching.length === 0) {
        return Promise.resolve({ _sum: { netAmount: null } });
      }
      const sum = matching.reduce((acc, row) => acc.plus(row.netAmount), new Prisma.Decimal(0));
      return Promise.resolve({ _sum: { netAmount: sum } });
    },
  );
}

describe('ReportsService', () => {
  const db = {
    $transaction: jest.fn(),
    booking: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  let service: ReportsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
    db.booking.groupBy.mockResolvedValue([]);
    db.booking.aggregate.mockResolvedValue({ _sum: { netAmount: null } });

    const moduleRef = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: db }],
    }).compile();

    service = moduleRef.get(ReportsService);
  });

  it('aggregates the 12-booking fixture (905.00 THB discounted net, 75% completion) in a RepeatableRead snapshot', async () => {
    const fixtures = buildSprint3Fixtures();
    const simulatedRows: SimulatedBookingRow[] = fixtures.classes.map((row) => ({
      tutorProfileId: row.tutorId,
      status: row.status,
      paymentStatus: row.paid ? PaymentStatus.PAID : PaymentStatus.UNPAID,
      netAmount: new Prisma.Decimal(row.net),
    }));
    wireSimulatedBookings(db, simulatedRows);

    const report = await service.getTutorReport(SPRINT3_IDS.tutors.report905);

    expect(report).toEqual({
      totalBookings: 12,
      statusCounts: {
        PENDING: 3,
        CONFIRMED: 1,
        COMPLETED: 6,
        CANCELED: 2,
        EXPIRED: 0,
      },
      revenue: {
        amount: '905.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 6,
        finalized: 8,
        percent: 75,
      },
    });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(db.booking.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { tutorProfileId: SPRINT3_IDS.tutors.report905 },
      _count: { _all: true },
    });
    expect(db.booking.aggregate).toHaveBeenCalledWith({
      where: {
        tutorProfileId: SPRINT3_IDS.tutors.report905,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
      },
      _sum: { netAmount: true },
    });
  });

  it('returns zero counts, "0.00" THB revenue, and null percent when a tutor has no bookings', async () => {
    const report = await service.getTutorReport(SPRINT3_IDS.tutors.reportEmpty);

    expect(report).toEqual({
      totalBookings: 0,
      statusCounts: {
        PENDING: 0,
        CONFIRMED: 0,
        COMPLETED: 0,
        CANCELED: 0,
        EXPIRED: 0,
      },
      revenue: {
        amount: '0.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 0,
        finalized: 0,
        percent: null,
      },
    });
  });

  it('excludes EXPIRED, PENDING, and CONFIRMED from finalized denominator and returns null percent when finalized is 0', async () => {
    wireSimulatedBookings(db, [
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.EXPIRED,
        paymentStatus: PaymentStatus.UNPAID,
        netAmount: new Prisma.Decimal('450.00'),
      },
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.EXPIRED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('500.00'),
      },
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('600.00'),
      },
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.PENDING,
        paymentStatus: PaymentStatus.UNPAID,
        netAmount: new Prisma.Decimal('300.00'),
      },
    ]);

    const report = await service.getTutorReport(TUTOR_A);

    expect(report).toEqual({
      totalBookings: 4,
      statusCounts: {
        PENDING: 1,
        CONFIRMED: 1,
        COMPLETED: 0,
        CANCELED: 0,
        EXPIRED: 2,
      },
      revenue: {
        amount: '0.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 0,
        finalized: 0,
        percent: null,
      },
    });
  });

  it('includes historical archived/deleted listing bookings and sums only PAID+COMPLETED netAmount across discounted, legacy mock, PromptPay, and zero-net history', async () => {
    wireSimulatedBookings(db, [
      // Discounted PromptPay-paid completed booking on an archived listing
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('405.00'),
        listingArchivedOrDeleted: true,
        paymentMethod: 'PROMPTPAY',
      },
      // Legacy mock-paid completed booking on a deleted listing
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('500.00'),
        listingArchivedOrDeleted: true,
        paymentMethod: 'LEGACY_MOCK',
      },
      // 100%-coupon zero-net settled completed booking
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('0.00'),
        paymentMethod: 'COUPON_ZERO',
      },
      // Unpaid completed booking must NOT enter revenue
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.UNPAID,
        netAmount: new Prisma.Decimal('999.00'),
      },
      // Paid confirmed (scheduled) and paid canceled must NOT enter revenue
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('700.00'),
      },
      {
        tutorProfileId: TUTOR_A,
        status: BookingStatus.CANCELED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('800.00'),
      },
      // Foreign tutor booking must remain isolated
      {
        tutorProfileId: TUTOR_B,
        status: BookingStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        netAmount: new Prisma.Decimal('1200.00'),
      },
    ]);

    const tutorAReport = await service.getTutorReport(TUTOR_A);
    expect(tutorAReport).toEqual({
      totalBookings: 6,
      statusCounts: {
        PENDING: 0,
        CONFIRMED: 1,
        COMPLETED: 4,
        CANCELED: 1,
        EXPIRED: 0,
      },
      revenue: {
        amount: '905.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 4,
        finalized: 5,
        percent: 80,
      },
    });

    const tutorBReport = await service.getTutorReport(TUTOR_B);
    expect(tutorBReport).toEqual({
      totalBookings: 1,
      statusCounts: {
        PENDING: 0,
        CONFIRMED: 0,
        COMPLETED: 1,
        CANCELED: 0,
        EXPIRED: 0,
      },
      revenue: {
        amount: '1200.00',
        currency: 'THB',
      },
      completionRate: {
        completed: 1,
        finalized: 1,
        percent: 100,
      },
    });
  });

  it.each([
    { completed: 2, canceled: 1, expired: 3, expectedFinalized: 3, expectedPercent: 66.67 },
    { completed: 1, canceled: 2, expired: 0, expectedFinalized: 3, expectedPercent: 33.33 },
    { completed: 1, canceled: 799, expired: 10, expectedFinalized: 800, expectedPercent: 0.13 },
    { completed: 3, canceled: 797, expired: 0, expectedFinalized: 800, expectedPercent: 0.38 },
    { completed: 0, canceled: 2, expired: 1, expectedFinalized: 2, expectedPercent: 0 },
  ])(
    'rounds completion percentage HALF_UP to 2 decimals ($completed / $expectedFinalized -> $expectedPercent)',
    async ({ completed, canceled, expired, expectedFinalized, expectedPercent }) => {
      db.booking.groupBy.mockResolvedValue([
        ...(completed > 0
          ? [{ status: BookingStatus.COMPLETED, _count: { _all: completed } }]
          : []),
        ...(canceled > 0 ? [{ status: BookingStatus.CANCELED, _count: { _all: canceled } }] : []),
        ...(expired > 0 ? [{ status: BookingStatus.EXPIRED, _count: { _all: expired } }] : []),
      ]);
      db.booking.aggregate.mockResolvedValue({ _sum: { netAmount: null } });

      const report = await service.getTutorReport(TUTOR_A);

      expect(report.completionRate).toEqual({
        completed,
        finalized: expectedFinalized,
        percent: expectedPercent,
      });
    },
  );
});

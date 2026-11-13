import { resolve } from 'node:path';

import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { buildSprint3Fixtures } from '@infrastructure/database/seed/sprint3-fixtures';
import { ReportsService } from '@modules/reports/reports.service';

import type { TutorReportResponseDto } from '@modules/reports/reports.dto';

interface ReportLedgerRow {
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  netAmount: string;
}

const { disposableTutorReportDatabaseUrl, expectedTutorReport } = jest.requireActual<{
  disposableTutorReportDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
  expectedTutorReport: (rows: readonly ReportLedgerRow[]) => TutorReportResponseDto;
}>(resolve(__dirname, '../../..', 'scripts/verify-tutor-reports.ts'));

type LedgerGroup = [count: number, status: BookingStatus, paid: boolean, net: string];

function ledger(...groups: LedgerGroup[]): ReportLedgerRow[] {
  return groups.flatMap(([count, status, paid, netAmount]) =>
    Array.from({ length: count }, () => ({
      status,
      paymentStatus: paid ? PaymentStatus.PAID : PaymentStatus.UNPAID,
      netAmount,
    })),
  );
}

describe('tutor report verifier (S3-T11)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55432/hktutor_s3_t11_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };
  const groupBy = jest.fn();
  let service: ReportsService;

  /** Returns the ledger the way PostgreSQL GROUP BY (status, paymentStatus) would. */
  function wireLedger(rows: readonly ReportLedgerRow[]): void {
    const groups = new Map<string, { row: ReportLedgerRow; count: number; sum: Prisma.Decimal }>();
    for (const row of rows) {
      const key = `${row.status}|${row.paymentStatus}`;
      const group = groups.get(key) ?? { row, count: 0, sum: new Prisma.Decimal(0) };
      group.count += 1;
      group.sum = group.sum.plus(row.netAmount);
      groups.set(key, group);
    }
    groupBy.mockResolvedValue(
      [...groups.values()].map(({ row, count, sum }) => ({
        status: row.status,
        paymentStatus: row.paymentStatus,
        _count: { _all: count },
        _sum: { netAmount: sum },
      })),
    );
  }

  beforeEach(async () => {
    groupBy.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: { booking: { groupBy } } }],
    }).compile();
    service = moduleRef.get(ReportsService);
  });

  it('requires the explicit opt-in and a URL without reading a fallback .env', () => {
    expect(() => disposableTutorReportDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableTutorReportDatabaseUrl(approved)).toThrow();
    expect(() =>
      disposableTutorReportDatabaseUrl({
        HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: 'true',
        DATABASE_URL: safe,
      }),
    ).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_s3_t11_test',
    'postgresql://tester@db.supabase.co/hktutor_s3_t11_test',
    'postgresql://tester@localhost/hktutor_s3_db06_test',
    'postgresql://tester@localhost/hktutor',
    `${safe}?schema=shared`,
    `${safe}#shared`,
  ])('refuses the unsafe or shared target %s', (value) => {
    expect(() => disposableTutorReportDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the dedicated loopback target on %s',
    (host) => {
      const value = `postgresql://tester@${host}:55432/hktutor_s3_t11_test`;
      expect(disposableTutorReportDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(value);
    },
  );

  it('reproduces the DB04 905 THB / 75% ledger from the pure fixture inputs', () => {
    const rows = buildSprint3Fixtures()
      .classes.filter((row) => row.group === 'report905')
      .map((row) => ({
        status: row.status,
        paymentStatus: row.paid ? PaymentStatus.PAID : PaymentStatus.UNPAID,
        netAmount: row.net,
      }));

    expect(expectedTutorReport(rows)).toEqual({
      totalBookings: 12,
      statusCounts: { PENDING: 3, CONFIRMED: 1, COMPLETED: 6, CANCELED: 2, EXPIRED: 0 },
      revenue: { amount: '905.00', currency: 'THB' },
      completionRate: { completed: 6, finalized: 8, percent: 75 },
    });
  });

  it.each<[string, LedgerGroup[], number | null, string]>([
    ['empty ledger', [], null, '0.00'],
    ['expired only', [[1, BookingStatus.EXPIRED, false, '450.00']], null, '0.00'],
    [
      'pending and paid confirmed only',
      [
        [2, BookingStatus.PENDING, false, '450.00'],
        [1, BookingStatus.CONFIRMED, true, '450.00'],
      ],
      null,
      '0.00',
    ],
    [
      '1 of 32 rounds HALF_UP to 3.13',
      [
        [1, BookingStatus.COMPLETED, true, '450.00'],
        [31, BookingStatus.CANCELED, false, '450.00'],
      ],
      3.13,
      '450.00',
    ],
    [
      '2 of 3 with sub-baht revenue',
      [
        [2, BookingStatus.COMPLETED, true, '0.10'],
        [1, BookingStatus.CANCELED, false, '450.00'],
      ],
      66.67,
      '0.20',
    ],
    [
      '1 unpaid completed of 3',
      [
        [1, BookingStatus.COMPLETED, false, '450.00'],
        [2, BookingStatus.CANCELED, false, '450.00'],
      ],
      33.33,
      '0.00',
    ],
    ['all completed', [[3, BookingStatus.COMPLETED, true, '333.33']], 100, '999.99'],
  ])('%s: the oracle and ReportsService agree', async (_label, groups, percent, revenue) => {
    const rows = ledger(...groups);
    const oracle = expectedTutorReport(rows);
    wireLedger(rows);

    expect(oracle.completionRate.percent).toBe(percent);
    expect(oracle.revenue.amount).toBe(revenue);
    await expect(service.getTutorReport('tutor-under-test')).resolves.toEqual(oracle);
  });
});

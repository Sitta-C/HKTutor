import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { configureApplication } from '@app/app.setup';
import { Prisma } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { buildSprint3Fixtures, SPRINT3_IDS } from '@infrastructure/database/seed/sprint3-fixtures';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { ReportsController } from '@modules/reports/reports.controller';
import { ReportsService } from '@modules/reports/reports.service';
import { TUTOR_REPORT_EXAMPLES } from '@modules/reports/reports.swagger';

import type { Sprint3ClassFixture } from '@infrastructure/database/seed/sprint3-fixtures';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

const fixtures = buildSprint3Fixtures();
type TutorGroup = keyof typeof SPRINT3_IDS.tutors;
const ledgerOf = (group: TutorGroup): Sprint3ClassFixture[] =>
  fixtures.classes.filter((row) => row.group === group);
const isTutorGroup = (key: string): key is TutorGroup => key in SPRINT3_IDS.tutors;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a nested OpenAPI object without trusting its shape. */
function at(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);
}

/** Groups fixture bookings the way PostgreSQL GROUP BY (status, paymentStatus) would. */
function groupedRows(rows: readonly Sprint3ClassFixture[]) {
  const groups = new Map<
    string,
    { status: BookingStatus; paymentStatus: PaymentStatus; count: number; sum: Prisma.Decimal }
  >();
  for (const row of rows) {
    const paymentStatus = row.paid ? PaymentStatus.PAID : PaymentStatus.UNPAID;
    const key = `${row.status}|${paymentStatus}`;
    const group = groups.get(key) ?? {
      status: row.status,
      paymentStatus,
      count: 0,
      sum: new Prisma.Decimal(0),
    };
    group.count += 1;
    group.sum = group.sum.plus(row.net);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    status: group.status,
    paymentStatus: group.paymentStatus,
    _count: { _all: group.count },
    _sum: { netAmount: group.sum },
  }));
}

describe('tutor report contract and fixture reconciliation (S3-T12)', () => {
  const groupBy = jest.fn();
  let app: INestApplication;
  let document: OpenAPIObject;
  let service: ReportsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        ReportsService,
        JwtAuthGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: {} },
        { provide: PrismaService, useValue: { booking: { groupBy } } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    service = moduleRef.get(ReportsService);
  });

  afterAll(async () => {
    await app.close();
  });

  const operation = (): unknown => at(document.paths, '/api/v1/reports/tutor/me', 'get');

  it.each(Object.entries(TUTOR_REPORT_EXAMPLES))(
    'Swagger example %s is exactly what ReportsService returns for that DB04 tutor',
    async (group, example) => {
      if (!isTutorGroup(group)) {
        throw new Error(`Swagger example ${group} does not name a DB04 fixture tutor`);
      }
      groupBy.mockResolvedValueOnce(groupedRows(ledgerOf(group)));

      await expect(service.getTutorReport(SPRINT3_IDS.tutors[group])).resolves.toEqual(
        example.value,
      );
      expect(
        at(operation(), 'responses', '200', 'content', 'application/json', 'examples', group),
      ).toEqual(example);
    },
  );

  it('assembles the schema property examples into the same 905 THB fixture report', () => {
    const schemas = document.components?.schemas ?? {};
    const exampleOf = (name: string): Record<string, unknown> => {
      const schema: unknown = schemas[name];
      const properties = at(schema, 'properties');
      if (!isRecord(properties)) {
        throw new Error(`Missing ${name} properties`);
      }
      return Object.fromEntries(
        Object.entries(properties).map(([key, property]) => [key, at(property, 'example')]),
      );
    };

    expect({
      totalBookings: exampleOf('TutorReportResponseDto')['totalBookings'],
      statusCounts: exampleOf('TutorReportStatusCountsDto'),
      revenue: exampleOf('TutorReportRevenueDto'),
      completionRate: exampleOf('TutorReportCompletionRateDto'),
    }).toEqual(TUTOR_REPORT_EXAMPLES.report905.value);
  });

  it('documents the finalized denominator, rounding, null rate and revenue exclusions', () => {
    const description = at(operation(), 'description');
    const schemas: unknown = document.components?.schemas;
    const finalized = at(schemas, 'TutorReportCompletionRateDto', 'properties', 'finalized');
    const percent = at(schemas, 'TutorReportCompletionRateDto', 'properties', 'percent');
    const revenue = at(schemas, 'TutorReportRevenueDto', 'properties', 'amount');

    expect(description).toEqual(expect.stringContaining('COMPLETED + CANCELED'));
    expect(description).toEqual(expect.stringContaining('HALF_UP'));
    expect(description).toEqual(expect.stringContaining('null when finalized is 0'));
    expect(description).toEqual(expect.stringContaining('a PAID booking can never be CANCELED'));
    expect(at(finalized, 'description')).toEqual(
      expect.stringContaining('EXPIRED, PENDING, and CONFIRMED are excluded'),
    );
    expect(at(percent, 'nullable')).toBe(true);
    expect(at(revenue, 'description')).toEqual(
      expect.stringContaining('after any coupon discount'),
    );
  });

  describe('DB04 report905 booking ledger', () => {
    const ledger = ledgerOf('report905');
    const welcome10 = fixtures.coupons.find((coupon) => coupon.key === 'welcome10');
    const sum = (rows: readonly Sprint3ClassFixture[], field: 'net' | 'subtotal'): string =>
      rows.reduce((total, row) => total.plus(row[field]), new Prisma.Decimal(0)).toFixed(2);

    it('balances every booking snapshot and prices the one coupon discount at 10% of 450.00', () => {
      expect(ledger).toHaveLength(12);
      for (const row of ledger) {
        expect(new Prisma.Decimal(row.subtotal).minus(row.discount).toFixed(2)).toBe(row.net);
      }
      const discounted = ledger.filter((row) => row.discount !== '0.00');
      expect(discounted).toHaveLength(1);
      expect(discounted[0]).toMatchObject({
        couponKey: 'welcome10',
        status: BookingStatus.COMPLETED,
        paid: true,
        subtotal: '450.00',
        discount: '45.00',
        net: '405.00',
      });
      expect(welcome10?.percent).toBe(10);
    });

    it('reconciles 905.00 revenue plus 4500.00 excluded amounts to the 5405.00 ledger total', () => {
      const revenueRows = ledger.filter(
        (row) => row.status === BookingStatus.COMPLETED && row.paid,
      );
      const excluded = {
        unpaidCompleted: ledger.filter(
          (row) => row.status === BookingStatus.COMPLETED && !row.paid,
        ),
        canceled: ledger.filter((row) => row.status === BookingStatus.CANCELED),
        pending: ledger.filter((row) => row.status === BookingStatus.PENDING),
        confirmed: ledger.filter((row) => row.status === BookingStatus.CONFIRMED),
      };

      expect(revenueRows.map((row) => row.net)).toEqual(['405.00', '500.00']);
      expect(sum(revenueRows, 'net')).toBe('905.00');
      expect(sum(revenueRows, 'subtotal')).toBe('950.00');
      expect(
        Object.fromEntries(
          Object.entries(excluded).map(([key, rows]) => [key, [rows.length, sum(rows, 'net')]]),
        ),
      ).toEqual({
        unpaidCompleted: [4, '1800.00'],
        canceled: [2, '900.00'],
        pending: [3, '1350.00'],
        confirmed: [1, '450.00'],
      });
      expect(sum(ledger, 'net')).toBe('5405.00');
      expect(ledger.some((row) => row.status === BookingStatus.CANCELED && row.paid)).toBe(false);
    });
  });
});

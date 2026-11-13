import { Injectable } from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { REPORT_CURRENCY } from '@modules/reports/reports.dto';

import type {
  TutorReportResponseDto,
  TutorReportStatusCountsDto,
} from '@modules/reports/reports.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTutorReport(tutorUserId: string): Promise<TutorReportResponseDto> {
    // One GROUP BY statement reads a single consistent PostgreSQL MVCC snapshot in one scan
    // without holding a pooled connection open across an interactive transaction.
    const rows = await this.prisma.booking.groupBy({
      by: ['status', 'paymentStatus'],
      where: { tutorProfileId: tutorUserId },
      _count: { _all: true },
      _sum: { netAmount: true },
    });

    const statusCounts: TutorReportStatusCountsDto = {
      PENDING: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELED: 0,
      EXPIRED: 0,
    };

    let revenueDecimal = new Prisma.Decimal(0);

    for (const row of rows) {
      statusCounts[row.status] += row._count._all;
      if (
        row.status === BookingStatus.COMPLETED &&
        row.paymentStatus === PaymentStatus.PAID &&
        row._sum.netAmount !== null
      ) {
        revenueDecimal = revenueDecimal.plus(row._sum.netAmount);
      }
    }

    const totalBookings =
      statusCounts.PENDING +
      statusCounts.CONFIRMED +
      statusCounts.COMPLETED +
      statusCounts.CANCELED +
      statusCounts.EXPIRED;

    // Per S3-T09, finalized includes every CANCELED outcome (tutor declines of PENDING requests
    // as well as student/tutor cancellations) and excludes EXPIRED, PENDING, and CONFIRMED.
    const finalized = statusCounts.COMPLETED + statusCounts.CANCELED;
    const percent =
      finalized === 0
        ? null
        : new Prisma.Decimal(statusCounts.COMPLETED)
            .times(100)
            .dividedBy(finalized)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            .toNumber();

    return {
      totalBookings,
      statusCounts,
      revenue: {
        amount: revenueDecimal.toFixed(2),
        currency: REPORT_CURRENCY,
      },
      completionRate: {
        completed: statusCounts.COMPLETED,
        finalized,
        percent,
      },
    };
  }
}

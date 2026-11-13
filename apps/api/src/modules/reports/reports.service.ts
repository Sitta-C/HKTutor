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
    // Run counts and revenue inside one RepeatableRead snapshot so concurrent booking/payment
    // commits cannot split the status breakdown and received revenue across different states.
    return this.prisma.$transaction(
      async (tx) => {
        const [statusRows, paidCompletedAggregate] = await Promise.all([
          tx.booking.groupBy({
            by: ['status'],
            where: { tutorProfileId: tutorUserId },
            _count: { _all: true },
          }),
          tx.booking.aggregate({
            where: {
              tutorProfileId: tutorUserId,
              status: BookingStatus.COMPLETED,
              paymentStatus: PaymentStatus.PAID,
            },
            _sum: { netAmount: true },
          }),
        ]);

        const statusCounts: TutorReportStatusCountsDto = {
          PENDING: 0,
          CONFIRMED: 0,
          COMPLETED: 0,
          CANCELED: 0,
          EXPIRED: 0,
        };

        for (const row of statusRows) {
          statusCounts[row.status] = row._count._all;
        }

        const totalBookings =
          statusCounts.PENDING +
          statusCounts.CONFIRMED +
          statusCounts.COMPLETED +
          statusCounts.CANCELED +
          statusCounts.EXPIRED;

        const revenueDecimal = paidCompletedAggregate._sum.netAmount ?? new Prisma.Decimal(0);
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { PAYMENT_DEADLINE_MS } from '@modules/bookings/booking-payment-policy';

@Injectable()
export class BookingExpiryService {
  private readonly logger = new Logger(BookingExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'booking-payment-expiry',
    timeZone: 'UTC',
    waitForCompletion: true,
    disabled: process.env['NODE_ENV'] === 'test',
  })
  async tick(): Promise<void> {
    try {
      await this.runOnce(new Date());
    } catch {
      this.logger.error('Booking expiry failed; retrying next tick');
    }
  }

  async runOnce(nowUtc: Date): Promise<number> {
    if (!Number.isFinite(nowUtc.getTime())) {
      throw new RangeError('nowUtc must be a valid date');
    }
    // The conditional UPDATE contends on the same booking rows as payment creation/settlement.
    // Never infer provider failure from the clock or release an uncertain payment/reservation.
    const { count } = await this.prisma.booking.updateMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        paymentStatus: 'UNPAID',
        paymentPending: false,
        slot: { startAtUtc: { lte: new Date(nowUtc.getTime() + PAYMENT_DEADLINE_MS) } },
        paymentAttempts: { none: { status: { in: ['CREATING', 'PENDING'] } } },
        couponReservations: { none: { status: 'RESERVED' } },
      },
      data: { status: 'EXPIRED' },
    });
    return count;
  }
}

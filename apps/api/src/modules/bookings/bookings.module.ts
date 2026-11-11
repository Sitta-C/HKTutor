import { Module } from '@nestjs/common';

import { BookingCouponsService } from '@modules/bookings/booking-coupons.service';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';

@Module({
  controllers: [BookingsController],
  exports: [BookingsService, BookingCouponsService],
  imports: [NotificationsModule],
  providers: [BookingsService, BookingCouponsService],
})
export class BookingsModule {}

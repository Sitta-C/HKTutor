import { Module } from '@nestjs/common';

import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';

@Module({
  controllers: [BookingsController],
  imports: [NotificationsModule],
  providers: [BookingsService],
})
export class BookingsModule {}

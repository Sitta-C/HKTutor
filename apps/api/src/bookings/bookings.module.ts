import { Module } from '@nestjs/common';

import { BookingsController } from '@/bookings/bookings.controller';
import { BookingsService } from '@/bookings/bookings.service';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}

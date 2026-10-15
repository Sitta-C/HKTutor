import { Module } from '@nestjs/common';

import { DatabaseModule } from '@infrastructure/database/database.module';
import {
  BookingRescheduleRequestsController,
  RescheduleRequestsController,
} from '@modules/reschedule-requests/reschedule-requests.controller';
import { RescheduleRequestsService } from '@modules/reschedule-requests/reschedule-requests.service';

@Module({
  controllers: [BookingRescheduleRequestsController, RescheduleRequestsController],
  exports: [RescheduleRequestsService],
  imports: [DatabaseModule],
  providers: [RescheduleRequestsService],
})
export class RescheduleRequestsModule {}

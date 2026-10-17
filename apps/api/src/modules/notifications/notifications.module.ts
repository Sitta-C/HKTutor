import { Module } from '@nestjs/common';

import { NotificationEventsService } from '@modules/notifications/notification-events.service';

@Module({
  exports: [NotificationEventsService],
  providers: [NotificationEventsService],
})
export class NotificationsModule {}

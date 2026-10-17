import { Module } from '@nestjs/common';

import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { NotificationsController } from '@modules/notifications/notifications.controller';
import { NotificationsService } from '@modules/notifications/notifications.service';

@Module({
  exports: [NotificationEventsService],
  controllers: [NotificationsController],
  providers: [NotificationEventsService, NotificationsService],
})
export class NotificationsModule {}

import { Module } from '@nestjs/common';

import { PaymentsConfigService } from '@config/payments.config';
import { OmiseService } from '@infrastructure/payments/omise.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OmiseWebhookController, PaymentsController } from '@modules/payments/payments.controller';
import { PaymentsService } from '@modules/payments/payments.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController, OmiseWebhookController],
  providers: [PaymentsConfigService, OmiseService, PaymentsService],
})
export class PaymentsModule {}

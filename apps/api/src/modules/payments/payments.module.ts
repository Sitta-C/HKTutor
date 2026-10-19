import { Module } from '@nestjs/common';

import { PaymentsConfigService } from '@config/payments.config';
import { OmiseService } from '@infrastructure/payments/omise.service';
import { OmiseWebhookController, PaymentsController } from '@modules/payments/payments.controller';
import { PaymentsService } from '@modules/payments/payments.service';

@Module({
  controllers: [PaymentsController, OmiseWebhookController],
  providers: [PaymentsConfigService, OmiseService, PaymentsService],
})
export class PaymentsModule {}

import { Module } from '@nestjs/common';

import { AuthConfigService } from '@/config/auth.config';
import { EmailService } from '@/email/email.service';

@Module({
  providers: [AuthConfigService, EmailService],
  exports: [EmailService],
})
export class EmailModule {}

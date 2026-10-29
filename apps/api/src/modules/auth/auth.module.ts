import { Global, Module } from '@nestjs/common';

import { AuthConfigService } from '@config/auth.config';
import { EmailModule } from '@infrastructure/email/email.module';
import { AuthController } from '@modules/auth/auth.controller';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { AuthService } from '@modules/auth/auth.service';
import { EmailFlowService } from '@modules/auth/email-flow.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { PasswordService } from '@modules/auth/password.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { SessionRevocations } from '@modules/auth/session-revocations';

@Global()
@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [
    AuthConfigService,
    AuthService,
    EmailFlowService,
    JwtAuthGuard,
    JwtTokenService,
    PasswordService,
    ResourceOwnershipGuard,
    RolesGuard,
    SessionRevocations,
  ],
  exports: [JwtAuthGuard, JwtTokenService, ResourceOwnershipGuard, RolesGuard, SessionRevocations],
})
export class AuthModule {}

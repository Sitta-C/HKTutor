import { Global, Module } from '@nestjs/common';

import { AuthConfigService } from '@config/auth.config';
import { EmailModule } from '@infrastructure/email/email.module';
import { AuthController } from '@modules/auth/auth.controller';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { AuthService } from '@modules/auth/auth.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { PasswordService } from '@modules/auth/password.service';
import { RolesGuard } from '@modules/auth/roles.guard';

@Global()
@Module({
  imports: [EmailModule],
  controllers: [AuthController],
  providers: [
    AuthConfigService,
    AuthService,
    JwtAuthGuard,
    JwtTokenService,
    PasswordService,
    ResourceOwnershipGuard,
    RolesGuard,
  ],
  exports: [JwtAuthGuard, JwtTokenService, ResourceOwnershipGuard, RolesGuard],
})
export class AuthModule {}

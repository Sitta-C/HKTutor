import { Global, Module } from '@nestjs/common';

import { AuthController } from '@/auth/auth.controller';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import { JwtTokenService } from '@/auth/jwt.service';
import { PasswordService } from '@/auth/password.service';
import { RolesGuard } from '@/auth/roles.guard';
import { AuthConfigService } from '@/config/auth.config';
import { EmailModule } from '@/email/email.module';

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
    RolesGuard,
  ],
  exports: [JwtAuthGuard, JwtTokenService, RolesGuard],
})
export class AuthModule {}

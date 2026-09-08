import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/auth.decorator';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import { AuthExampleResponseDto } from '@/examples/auth-example.dto';
import { GetProtectedAuthExampleDoc } from '@/examples/auth-example.swagger';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';

@ApiTags('examples')
@Controller('api/examples')
// Authentication must run before authorization so RolesGuard can read request.auth.
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthExampleController {
  @Get('protected')
  @GetProtectedAuthExampleDoc()
  @Roles(Role.TUTOR, Role.ADMIN)
  getProtectedExample(@CurrentUser() user: AuthenticatedUser): AuthExampleResponseDto {
    return {
      email: user.email,
      message: 'Authenticated tutor/admin request accepted',
      role: user.role,
      userId: user.id,
    };
  }
}

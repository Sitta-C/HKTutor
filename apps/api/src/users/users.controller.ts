import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ClerkAuthGuard } from '@/auth/auth.guard';
import { OnboardingConsentDto } from '@/users/users.dto';
import { UsersService } from '@/users/users.service';
import { PostOnboardingDoc } from '@/users/users.swagger';

import type { AuthenticatedRequest } from '@/auth/auth.guard';
import type { OnboardingConsentResult } from '@/users/users.service';

@ApiTags('users')
@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('auth/:id')
  //   @GetTutorsDoc()
  async getCleckUserID(@Param('id') id: string): Promise<string | null> {
    return this.usersService.getCleckUserID(id);
  }

  @Post('onboarding')
  @UseGuards(ClerkAuthGuard)
  @PostOnboardingDoc()
  async completeOnboarding(
    @Req() request: AuthenticatedRequest,
    @Body() dto: OnboardingConsentDto,
  ): Promise<OnboardingConsentResult> {
    const clerkUserId = request.auth?.userId;

    if (!clerkUserId) {
      throw new UnauthorizedException('Missing verified Clerk user id');
    }

    return this.usersService.completeOnboarding(clerkUserId, dto);
  }
}

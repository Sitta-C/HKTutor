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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ClerkAuthGuard } from '@/auth/auth.guard';
import { OnboardingConsentDto } from '@/users/users.dto';
import { UsersService } from '@/users/users.service';

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
  @ApiOperation({ summary: 'Accept the privacy notice and complete onboarding' })
  @ApiResponse({ status: 201, description: 'Onboarding consent persisted' })
  @ApiResponse({ status: 400, description: 'Consent was declined or the payload is invalid' })
  @ApiResponse({ status: 409, description: 'Account already onboarded with a different role' })
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

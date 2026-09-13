import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { REFRESH_COOKIE_NAME } from '@/auth/auth.constants';
import { CurrentUser } from '@/auth/auth.decorator';
import {
  AcceptPrivacyNoticeDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from '@/auth/auth.dto';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import {
  AcceptPrivacyNoticeAuthDoc,
  AuthControllerDoc,
  GetCurrentUserAuthDoc,
  LoginAuthDoc,
  LogoutAuthDoc,
  RefreshAuthDoc,
  RegisterAuthDoc,
  ResendVerificationAuthDoc,
  VerifyEmailAuthDoc,
} from '@/auth/auth.swagger';
import { AuthConfigService } from '@/config/auth.config';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { AuthResult } from '@/auth/auth.types';
import type { Request, Response } from 'express';

@AuthControllerDoc()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfigService,
  ) {}

  @Post('register')
  @RegisterAuthDoc()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto): Promise<{ message: string }> {
    return this.auth.register(dto);
  }

  @Post('verify-email')
  @VerifyEmailAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Omit<AuthResult, 'refreshToken'>> {
    return this.setSessionResponse(response, await this.auth.verifyEmail(dto));
  }

  @Post('resend-verification')
  @ResendVerificationAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<{ message: string }> {
    return this.auth.resendVerification(dto);
  }

  @Post('login')
  @LoginAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Omit<AuthResult, 'refreshToken'>> {
    return this.setSessionResponse(response, await this.auth.login(dto));
  }

  @Post('refresh')
  @RefreshAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Omit<AuthResult, 'refreshToken'>> {
    const result = await this.auth.refresh(this.refreshCookie(request));
    return this.setSessionResponse(response, result);
  }

  @Post('logout')
  @LogoutAuthDoc()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(this.refreshCookie(request));
    response.clearCookie(REFRESH_COOKIE_NAME, this.config.refreshCookieOptions);
  }

  @Post('consent')
  @AcceptPrivacyNoticeAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async acceptPrivacyNotice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptPrivacyNoticeDto,
  ): Promise<{ consentAcceptedAt: Date; policyVersion: string }> {
    return this.auth.acceptPrivacyNotice(user.id, dto);
  }

  @Get('me')
  @GetCurrentUserAuthDoc()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Omit<AuthenticatedUser, 'sessionId'> {
    return { id: user.id, email: user.email, role: user.role };
  }

  private setSessionResponse(
    response: Response,
    result: AuthResult,
  ): Omit<AuthResult, 'refreshToken'> {
    response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, this.config.refreshCookieOptions);
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  private refreshCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_COOKIE_NAME];
    return typeof value === 'string' ? value : undefined;
  }
}

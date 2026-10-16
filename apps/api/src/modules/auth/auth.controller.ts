import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  HttpException,
  ServiceUnavailableException,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { AuthConfigService } from '@config/auth.config';
import { REFRESH_COOKIE_NAME } from '@modules/auth/auth.constants';
import { CurrentUser } from '@modules/auth/auth.decorator';
import {
  AcceptPrivacyNoticeDto,
  ForgotPasswordDto,
  EmailFlowQueryDto,
  LoginDto,
  ResetPasswordDto,
  RegisterDto,
  ResendEmailDto,
  VerifyEmailDto,
} from '@modules/auth/auth.dto';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { AuthService } from '@modules/auth/auth.service';
import {
  AcceptPrivacyNoticeAuthDoc,
  AuthControllerDoc,
  GetCurrentUserAuthDoc,
  ForgotPasswordAuthDoc,
  EmailFlowAuthDoc,
  ResendPasswordResetAuthDoc,
  LoginAuthDoc,
  ResetPasswordAuthDoc,
  LogoutAuthDoc,
  RefreshAuthDoc,
  RegisterAuthDoc,
  ResendVerificationAuthDoc,
  VerifyEmailAuthDoc,
} from '@modules/auth/auth.swagger';
import {
  EMAIL_FLOW_TTL_SECONDS,
  EmailFlowService,
  emailFlowCookieName,
} from '@modules/auth/email-flow.service';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { AuthResult } from '@modules/auth/auth.types';
import type { EmailFlow, EmailFlowPurpose } from '@modules/auth/email-flow.service';
import type { Request, Response } from 'express';

@AuthControllerDoc()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfigService,
    private readonly emailFlows: EmailFlowService,
  ) {}

  @Post('register')
  @RegisterAuthDoc()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string; emailFlow: EmailFlow }> {
    try {
      const result = await this.auth.register(dto);
      return { ...result, emailFlow: this.setEmailFlow(response, dto.email, 'verification') };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        this.setEmailFlow(response, dto.email, 'verification');
      }
      throw error;
    }
  }

  @Get('email-flow')
  @EmailFlowAuthDoc()
  @UseGuards(ThrottlerGuard)
  getEmailFlow(
    @Query() query: EmailFlowQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): EmailFlow {
    response.setHeader('Cache-Control', 'no-store');
    return this.emailFlows.read(
      this.cookie(request, emailFlowCookieName(query.purpose)),
      query.purpose,
    );
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
  async resendVerification(
    @Body() dto: ResendEmailDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string; emailFlow: EmailFlow }> {
    const flow = this.requireReadyFlow(request, response, 'verification', dto.flowId);
    // Reserve this browser's cooldown even when delivery fails.
    const next = this.setEmailFlow(response, flow.email, flow.purpose, flow.id);
    const result = await this.auth.resendVerification(flow.email);
    return { ...result, emailFlow: next };
  }

  @Post('forgot-password')
  @ForgotPasswordAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string; emailFlow: EmailFlow }> {
    const result = await this.auth.forgotPassword(dto);
    return { ...result, emailFlow: this.setEmailFlow(response, dto.email, 'password-reset') };
  }

  @Post('resend-password-reset')
  @ResendPasswordResetAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendPasswordReset(
    @Body() dto: ResendEmailDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string; emailFlow: EmailFlow }> {
    const flow = this.requireReadyFlow(request, response, 'password-reset', dto.flowId);
    const next = this.setEmailFlow(response, flow.email, flow.purpose, flow.id);
    const result = await this.auth.forgotPassword({ email: flow.email });
    return { ...result, emailFlow: next };
  }

  @Post('reset-password')
  @ResetPasswordAuthDoc()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.auth.resetPassword(dto);
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

  private setEmailFlow(
    response: Response,
    email: string,
    purpose: EmailFlowPurpose,
    id?: string,
  ): EmailFlow {
    const signed = this.emailFlows.create(email, purpose, id);
    response.cookie(emailFlowCookieName(purpose), signed.cookie, {
      ...this.config.refreshCookieOptions,
      path: '/api/v1/auth',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: EMAIL_FLOW_TTL_SECONDS * 1000,
    });
    response.setHeader('Cache-Control', 'no-store');
    return signed.flow;
  }

  private requireReadyFlow(
    request: Request,
    response: Response,
    purpose: EmailFlowPurpose,
    id: string,
  ): EmailFlow {
    const flow = this.emailFlows.read(this.cookie(request, emailFlowCookieName(purpose)), purpose);
    if (flow.id !== id) {
      throw new BadRequestException('Email request has changed. Reload this page.');
    }
    if (flow.retryAfterSeconds > 0) {
      response.setHeader('Retry-After', String(flow.retryAfterSeconds));
      throw new HttpException('Wait before requesting another email', HttpStatus.TOO_MANY_REQUESTS);
    }
    return flow;
  }

  private cookie(request: Request, name: string): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[name];
    return typeof value === 'string' ? value : undefined;
  }

  private refreshCookie(request: Request): string | undefined {
    return this.cookie(request, REFRESH_COOKIE_NAME);
  }
}

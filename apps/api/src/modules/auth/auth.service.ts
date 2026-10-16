import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthConfigService } from '@config/auth.config';
import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { PasswordService } from '@modules/auth/password.service';

import type { Prisma } from '@generated/prisma/client';
import type {
  AcceptPrivacyNoticeDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  RegisterDto,
  VerifyEmailDto,
} from '@modules/auth/auth.dto';
import type { AuthResult, JwtPayload, PublicUser } from '@modules/auth/auth.types';

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect';
const REGISTRATION_MESSAGE = 'If an account can be created, a verification email has been sent.';
const VERIFICATION_MESSAGE = 'If the account can be verified, a verification email has been sent.';

const PASSWORD_RESET_MESSAGE = 'If the account is eligible, a password reset email will be sent.';
const INVALID_RESET_LINK = 'Password reset link is invalid or expired';

const roleMap = {
  student: Role.STUDENT,
  tutor: Role.TUTOR,
} as const;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwtTokens: JwtTokenService,
    private readonly email: EmailService,
    private readonly config: AuthConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    if (!dto.consent) {
      throw new BadRequestException('Consent must be accepted to create an account');
    }

    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return { message: REGISTRATION_MESSAGE };
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.verificationExpiry();

    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            role: roleMap[dto.role],
            accountStatus: AccountStatus.ACTIVE,
            consentAcceptedAt: new Date(),
            policyVersion: dto.policyVersion,
          },
        });

        await tx.emailVerificationToken.create({
          data: { userId: user.id, tokenHash: digest(token), expiresAt },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { message: REGISTRATION_MESSAGE };
      }
      throw error;
    }

    await this.email.sendVerificationEmail(dto.email, token);
    return { message: REGISTRATION_MESSAGE };
  }

  async acceptPrivacyNotice(
    userId: string,
    dto: AcceptPrivacyNoticeDto,
  ): Promise<{ consentAcceptedAt: Date; policyVersion: string }> {
    if (!dto.consent) {
      throw new BadRequestException('Consent must be accepted to continue');
    }

    const consentAcceptedAt = new Date();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { consentAcceptedAt, policyVersion: dto.policyVersion },
      select: { consentAcceptedAt: true, policyVersion: true },
    });

    return {
      consentAcceptedAt: user.consentAcceptedAt ?? consentAcceptedAt,
      policyVersion: user.policyVersion ?? dto.policyVersion,
    };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      return { message: VERIFICATION_MESSAGE };
    }
    const delivery = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const eligible = await tx.user.findFirst({
        where: {
          id: user.id,
          deletedAt: null,
          accountStatus: AccountStatus.ACTIVE,
          emailVerifiedAt: null,
        },
        select: { email: true },
      });
      if (!eligible) {
        return null;
      }
      const now = new Date();
      const recent = await tx.emailVerificationToken.findFirst({
        where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 60_000) } },
        select: { id: true },
      });
      if (recent) {
        return null;
      }
      const token = randomBytes(32).toString('base64url');
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.emailVerificationToken.create({
        data: { userId: user.id, tokenHash: digest(token), expiresAt: this.verificationExpiry() },
      });
      return { email: eligible.email, token };
    });
    if (delivery) {
      await this.email.sendVerificationEmail(delivery.email, delivery.token);
    }
    return { message: VERIFICATION_MESSAGE };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<AuthResult> {
    const tokenRecord = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: digest(dto.token) },
      include: { user: true },
    });
    const now = new Date();

    if (
      !tokenRecord ||
      tokenRecord.consumedAt ||
      tokenRecord.expiresAt <= now ||
      tokenRecord.user.deletedAt ||
      tokenRecord.user.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new BadRequestException('Verification link is invalid or expired');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${tokenRecord.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: { id: tokenRecord.userId, deletedAt: null, accountStatus: AccountStatus.ACTIVE },
        select: { id: true, email: true, role: true, emailVerifiedAt: true },
      });
      const consumedAt = new Date();
      if (!user) {
        throw new BadRequestException('Verification link is invalid or expired');
      }
      const result = await tx.emailVerificationToken.updateMany({
        where: { id: tokenRecord.id, consumedAt: null, expiresAt: { gt: consumedAt } },
        data: { consumedAt },
      });
      if (result.count !== 1) {
        throw new BadRequestException('Verification link is invalid or expired');
      }
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? consumedAt },
      });
      return this.createSession({ id: user.id, email: user.email, role: user.role }, tx);
    });
  }

  forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    // Return before account lookup so database/provider latency cannot disclose eligibility.
    void this.issuePasswordReset(dto).catch(() => {
      this.logger.warn('Password reset request processing failed');
    });
    return Promise.resolve({ message: PASSWORD_RESET_MESSAGE });
  }

  private async issuePasswordReset(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        deletedAt: null,
        accountStatus: AccountStatus.ACTIVE,
        emailVerifiedAt: { not: null },
        passwordHash: { not: null },
      },
      select: { id: true },
    });
    if (!user) {
      return;
    }

    const delivery = await this.prisma.$transaction(async (tx) => {
      // Serialize issuance and redemption for an account, including requests from different IPs.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const eligible = await tx.user.findFirst({
        where: {
          id: user.id,
          deletedAt: null,
          accountStatus: AccountStatus.ACTIVE,
          emailVerifiedAt: { not: null },
          passwordHash: { not: null },
        },
        select: { email: true },
      });
      if (!eligible) {
        return null;
      }
      const now = new Date();
      const recent = await tx.passwordResetToken.findFirst({
        where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 60_000) } },
        select: { id: true },
      });
      if (recent) {
        return null;
      }
      const token = randomBytes(32).toString('base64url');
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: digest(token),
          expiresAt: new Date(now.getTime() + this.config.passwordResetTtlMinutes * 60_000),
        },
      });
      return { email: eligible.email, token };
    });

    if (delivery) {
      await this.email.sendPasswordResetEmail(delivery.email, delivery.token);
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: digest(dto.token) },
      select: { id: true, userId: true, consumedAt: true, expiresAt: true },
    });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException(INVALID_RESET_LINK);
    }
    const passwordHash = await this.passwords.hash(dto.password);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${record.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: {
          id: record.userId,
          deletedAt: null,
          accountStatus: AccountStatus.ACTIVE,
          emailVerifiedAt: { not: null },
          passwordHash: { not: null },
        },
        select: { id: true },
      });
      if (!user) {
        throw new BadRequestException(INVALID_RESET_LINK);
      }
      const now = new Date();
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(INVALID_RESET_LINK);
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    return { message: 'Password reset successfully. Sign in with your new password.' };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });

    if (!user?.passwordHash) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordMatches = await this.passwords
      .verify(user.passwordHash, dto.password)
      .catch(() => false);
    if (!passwordMatches) {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException('This account is not active');
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('Verify your email before signing in');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findFirst({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          deletedAt: null,
          accountStatus: AccountStatus.ACTIVE,
          emailVerifiedAt: { not: null },
        },
        select: { id: true },
      });
      if (!current) {
        throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
      }
      return this.createSession({ id: user.id, email: user.email, role: user.role }, tx);
    });
  }

  async refresh(refreshToken: string | undefined): Promise<AuthResult> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const payload = this.jwtTokens.verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });
    const now = new Date();

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.deletedAt ||
      session.user.accountStatus !== AccountStatus.ACTIVE ||
      !session.user.emailVerifiedAt
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const presentedHash = digest(refreshToken);
    if (!hashesMatch(session.refreshTokenHash, presentedHash)) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.rotateSession(payload, session.user, session.refreshTokenHash);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    const payload = this.jwtTokens.verifyRefreshToken(refreshToken);
    if (!payload) return;

    await this.prisma.authSession.updateMany({
      where: { id: payload.sid, userId: payload.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(
    user: PublicUser,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<AuthResult> {
    const sessionId = randomUUID();
    const refreshToken = this.jwtTokens.signRefreshToken(user.id, sessionId, user.role);

    await database.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: digest(refreshToken),
        expiresAt: this.refreshExpiry(),
      },
    });

    return {
      accessToken: this.jwtTokens.signAccessToken(user.id, sessionId, user.role),
      expiresIn: this.config.accessTtlSeconds,
      refreshToken,
      user,
    };
  }

  private async rotateSession(
    payload: JwtPayload,
    user: PublicUser,
    previousHash: string,
  ): Promise<AuthResult> {
    const refreshToken = this.jwtTokens.signRefreshToken(user.id, payload.sid, user.role);
    const expiresAt = this.refreshExpiry();
    const now = new Date();
    const updated = await this.prisma.authSession.updateMany({
      where: {
        id: payload.sid,
        refreshTokenHash: previousHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: digest(refreshToken),
        expiresAt,
        lastUsedAt: now,
      },
    });

    if (updated.count !== 1) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return {
      accessToken: this.jwtTokens.signAccessToken(user.id, payload.sid, user.role),
      expiresIn: this.config.accessTtlSeconds,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }

  private verificationExpiry(): Date {
    return new Date(Date.now() + this.config.verificationTtlMinutes * 60_000);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTtlSeconds * 1000);
  }
}

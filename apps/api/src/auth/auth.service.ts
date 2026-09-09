import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtTokenService } from '@/auth/jwt.service';
import { PasswordService } from '@/auth/password.service';
import { AuthConfigService } from '@/config/auth.config';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/email/email.service';
import { AccountStatus, Role } from '@/generated/prisma/client';

import type {
  AcceptPrivacyNoticeDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from '@/auth/auth.dto';
import type { AuthResult, JwtPayload, PublicUser } from '@/auth/auth.types';

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect';
const VERIFICATION_MESSAGE = 'If the account can be verified, a verification email has been sent.';

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
      throw new ConflictException('An account with this email already exists');
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
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }

    await this.email.sendVerificationEmail(dto.email, token);
    return { message: 'Check your email to verify your account.' };
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

  async resendVerification(dto: ResendVerificationDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true, email: true, emailVerifiedAt: true, accountStatus: true },
    });

    if (!user || user.emailVerifiedAt || user.accountStatus !== AccountStatus.ACTIVE) {
      return { message: VERIFICATION_MESSAGE };
    }

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: digest(token),
          expiresAt: this.verificationExpiry(),
        },
      });
    });

    await this.email.sendVerificationEmail(user.email, token);
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

    const consumed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.emailVerificationToken.updateMany({
        where: { id: tokenRecord.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (result.count !== 1) return false;

      await tx.user.update({
        where: { id: tokenRecord.userId },
        data: { emailVerifiedAt: tokenRecord.user.emailVerifiedAt ?? now },
      });
      return true;
    });

    if (!consumed) {
      throw new BadRequestException('Verification link is invalid or expired');
    }

    return this.createSession({
      id: tokenRecord.user.id,
      email: tokenRecord.user.email,
      role: tokenRecord.user.role,
    });
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

    return this.createSession({ id: user.id, email: user.email, role: user.role });
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

  private async createSession(user: PublicUser): Promise<AuthResult> {
    const sessionId = randomUUID();
    const refreshToken = this.jwtTokens.signRefreshToken(user.id, sessionId, user.role);

    await this.prisma.authSession.create({
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

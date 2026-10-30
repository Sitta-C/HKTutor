import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { AccountStatus, Role } from '@generated/prisma/client';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';

import type { PrismaService } from '@infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { JwtTokenService } from '@modules/auth/jwt.service';

export interface AccessSession {
  user: AuthenticatedUser;
  expiresAt: number;
}

/** Shared verification; REST routes opt into consent, while chat always requires it. */
export async function verifyAccessSession(
  token: string,
  jwtTokens: JwtTokenService,
  prisma: PrismaService,
  chat = false,
  requireCurrentConsent = false,
): Promise<AccessSession> {
  const payload = jwtTokens.verifyAccessToken(token);
  if (!payload) {
    throw new UnauthorizedException('Invalid or expired authentication token');
  }
  const session = await prisma.authSession.findUnique({
    where: { id: payload.sid },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== payload.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    throw new UnauthorizedException('Invalid or expired authentication token');
  }
  const account = session.user;
  if (
    account.deletedAt ||
    account.accountStatus !== AccountStatus.ACTIVE ||
    !account.emailVerifiedAt
  ) {
    if (chat) {
      throw new ForbiddenException('Chat access denied');
    }
    throw new UnauthorizedException('Invalid or expired authentication token');
  }
  if (
    (chat && account.role !== Role.STUDENT && account.role !== Role.TUTOR) ||
    ((chat || requireCurrentConsent) &&
      (!account.consentAcceptedAt || account.policyVersion !== CURRENT_PRIVACY_POLICY_VERSION))
  ) {
    throw new ForbiddenException(
      chat ? 'Chat access denied' : 'Accept the current privacy notice to continue.',
    );
  }
  return {
    user: { id: account.id, email: account.email, role: account.role, sessionId: payload.sid },
    expiresAt: Math.min(payload.exp * 1000, session.expiresAt.getTime()),
  };
}

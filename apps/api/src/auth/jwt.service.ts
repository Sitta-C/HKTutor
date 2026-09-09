import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

import { AuthConfigService } from '@/config/auth.config';

import type { JwtPayload } from '@/auth/auth.types';
import type { Role } from '@/generated/prisma/client';

@Injectable()
export class JwtTokenService {
  constructor(private readonly config: AuthConfigService) {}

  signAccessToken(userId: string, sessionId: string, role: Role): string {
    return jwt.sign(
      { jti: randomUUID(), role, sid: sessionId, type: 'access' },
      this.config.accessSecret,
      {
        audience: this.config.audience,
        expiresIn: this.config.accessTtlSeconds,
        issuer: this.config.issuer,
        subject: userId,
      },
    );
  }

  signRefreshToken(userId: string, sessionId: string, role: Role): string {
    return jwt.sign(
      { jti: randomUUID(), role, sid: sessionId, type: 'refresh' },
      this.config.refreshSecret,
      {
        audience: this.config.audience,
        expiresIn: this.config.refreshTtlSeconds,
        issuer: this.config.issuer,
        subject: userId,
      },
    );
  }

  verifyAccessToken(token: string): JwtPayload | null {
    return this.verify(token, this.config.accessSecret, 'access');
  }

  verifyRefreshToken(token: string): JwtPayload | null {
    return this.verify(token, this.config.refreshSecret, 'refresh');
  }

  private verify(
    token: string,
    secret: string,
    expectedType: JwtPayload['type'],
  ): JwtPayload | null {
    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        audience: this.config.audience,
        issuer: this.config.issuer,
      });

      if (
        typeof payload === 'string' ||
        payload['type'] !== expectedType ||
        !isNonEmptyString(payload.sub) ||
        !isNonEmptyString(payload['sid']) ||
        !isNonEmptyString(payload['jti']) ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        return null;
      }

      return payload as JwtPayload;
    } catch {
      return null;
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

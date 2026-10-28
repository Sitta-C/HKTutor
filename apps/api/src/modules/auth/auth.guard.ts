import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { verifyAccessSession } from '@modules/auth/access-session';
import { JwtTokenService } from '@modules/auth/jwt.service';

import type { Request as ExpressRequest } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}

export interface AuthenticatedRequest extends ExpressRequest {
  auth?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtTokens: JwtTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    request.auth = (await verifyAccessSession(token, this.jwtTokens, this.prisma)).user;

    return true;
  }

  private extractBearerToken(request: ExpressRequest): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}

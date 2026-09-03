// src/clerk/clerk-auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ClerkClient } from '@clerk/backend';
import { Request } from 'express';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    @Inject('CLERK_CLIENT') private readonly clerkClient: ClerkClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    // console.log(this.clerkClient.sessions.getToken("user_3Io8Nz2zdL3A6rE9WP3G2NQtCBB"))

    if (!token) {
        throw new UnauthorizedException('Missing authentication token');
    }

    try {
        const { isAuthenticated } = await this.clerkClient.authenticateRequest(request, {})

        if(!isAuthenticated) {
            throw new UnauthorizedException('Missing authentication token');
        }

      return true;
    } catch (error) {
      throw new UnauthorizedException('Authentication failed');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}



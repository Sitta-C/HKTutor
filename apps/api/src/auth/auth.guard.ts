// src/clerk/clerk-auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';

import type { ClerkClient } from '@clerk/backend';

export interface AuthenticatedRequest extends ExpressRequest {
  auth?: { userId: string };
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(@Inject('CLERK_CLIENT') private readonly clerkClient: ClerkClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const token = this.extractTokenFromHeader(context.switchToHttp().getRequest());

    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const protocol = request.protocol || 'http';
    const host = request.get('host') || 'localhost';
    const path = request.originalUrl || request.url || '/';

    const fullUrl = `${protocol}://${host}${path}`;

    const headers = new Headers();
    Object.entries(request.headers).forEach(([key, value]) => {
      if (value) {
        headers.append(key, Array.isArray(value) ? value.join(', ') : value);
      }
    });

    const webRequest = new Request(fullUrl, {
      method: request.method,
      headers: headers,
    });

    try {
      const authState = await this.clerkClient.authenticateRequest(webRequest);

      if (!authState.isAuthenticated) {
        throw new UnauthorizedException('Missing authentication token');
      }

      request.auth = { userId: authState.toAuth().userId };

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new UnauthorizedException(`Authentication failed: ${message}`);
    }
  }

  private extractTokenFromHeader(request: ExpressRequest): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

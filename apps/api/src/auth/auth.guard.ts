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

interface AuthenticatedRequest extends ExpressRequest {
  auth?: string;
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
      const { isAuthenticated } = await this.clerkClient.authenticateRequest(webRequest);

      if (!isAuthenticated) {
        throw new UnauthorizedException('Missing authentication token');
      }

      return true;
    } catch {
      return false;
    }
  }

  private extractTokenFromHeader(request: ExpressRequest): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

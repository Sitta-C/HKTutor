// src/auth/auth.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CLERK_CLIENT } from './clerk-client.provider';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    @Inject(CLERK_CLIENT) private readonly clerkClient: any,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.split(' ')[1];

    try {
      // Verify the JWT token using Clerk's token verification system
      const requestState = await this.clerkClient.authenticateRequest({
        request: {
          headers: new Headers({
            authorization: `Bearer ${token}`,
          }),
        },
      });

      if (!requestState.isSignedIn) {
        throw new UnauthorizedException('Token is invalid or expired');
      }

      // Attach the auth state to the request for use in controllers
      request.auth = requestState.toAuth();
      return true;
    } catch (error) {
      throw new UnauthorizedException('Authentication failed');
    }
  }
}

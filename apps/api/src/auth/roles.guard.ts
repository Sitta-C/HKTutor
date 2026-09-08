import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '@/auth/roles.decorator';

import type { AuthenticatedRequest } from '@/auth/auth.guard';
import type { Role } from '@/generated/prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<readonly Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!allowedRoles?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException('Authentication is required before role authorization');
    }

    if (!allowedRoles.includes(request.auth.role)) {
      throw new ForbiddenException('You do not have permission to access this resource');
    }

    return true;
  }
}

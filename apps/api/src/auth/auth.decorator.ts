import { createParamDecorator } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from '@/auth/auth.guard';
import type { ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);

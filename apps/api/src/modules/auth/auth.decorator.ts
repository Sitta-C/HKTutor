import { createParamDecorator, SetMetadata } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from '@modules/auth/auth.guard';
import type { ExecutionContext } from '@nestjs/common';

export const REQUIRE_CURRENT_CONSENT_KEY = 'auth:require-current-consent';

export const RequireCurrentConsent = (): MethodDecorator =>
  SetMetadata(REQUIRE_CURRENT_CONSENT_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);

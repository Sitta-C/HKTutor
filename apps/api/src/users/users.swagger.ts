import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CLERK_BEARER_AUTH } from '@/auth/auth.swagger';

export function PostOnboardingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Accept the privacy notice and complete onboarding' }),
    ApiBearerAuth(CLERK_BEARER_AUTH),
    ApiResponse({ status: 201, description: 'Onboarding consent persisted' }),
    ApiBadRequestResponse({
      description: 'Consent was declined or the payload is invalid',
      schema: {
        example: {
          error: 'Bad Request',
          message: 'Consent must be accepted to complete onboarding',
          statusCode: 400,
        },
        type: 'object',
      },
    }),
    ApiUnauthorizedResponse({
      description: 'No verified Clerk session or missing Clerk user id',
      schema: {
        example: {
          error: 'Unauthorized',
          message: 'Missing verified Clerk user id',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'Account already onboarded with a different role, already exists with a different role, or can no longer be onboarded',
      schema: {
        example: {
          error: 'Conflict',
          message: 'This account already onboarded with a different role',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

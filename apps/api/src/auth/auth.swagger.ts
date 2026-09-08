import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

export const CLERK_BEARER_AUTH = 'clerk-bearer';

export function VerifyClerkTokenDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Verify a Clerk-authenticated request' }),
    ApiBearerAuth(CLERK_BEARER_AUTH),
    ApiOkResponse({
      description: 'The Clerk bearer token is valid',
      schema: { example: 'Hello World!', type: 'string' },
    }),
    ApiUnauthorizedResponse({
      content: {
        'application/json': {
          examples: {
            invalidOrExpiredToken: {
              summary: 'Invalid or expired token',
              value: {
                error: 'Unauthorized',
                message: 'Invalid or expired authentication token',
                statusCode: 401,
              },
            },
            missingToken: {
              summary: 'Missing or malformed authorization header',
              value: {
                error: 'Unauthorized',
                message: 'Missing authentication token',
                statusCode: 401,
              },
            },
          },
          schema: {
            properties: {
              error: { example: 'Unauthorized', type: 'string' },
              message: { example: 'Missing authentication token', type: 'string' },
              statusCode: { example: 401, type: 'integer' },
            },
            required: ['message', 'error', 'statusCode'],
            type: 'object',
          },
        },
      },
      description: 'The Clerk bearer token is missing, malformed, invalid, or expired',
    }),
  );
}

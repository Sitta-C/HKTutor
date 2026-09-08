import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { AuthExampleResponseDto } from '@/examples/auth-example.dto';

const errorResponseSchema = {
  example: {
    error: 'Unauthorized',
    message: 'Invalid or expired authentication token',
    statusCode: 401,
  },
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    statusCode: { type: 'number' },
  },
  type: 'object',
} as const;

export function GetProtectedAuthExampleDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Example of a JWT-protected endpoint restricted to tutors and admins',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({
      description: 'The JWT, backing session, account state, and role are valid',
      type: AuthExampleResponseDto,
    }),
    ApiUnauthorizedResponse({
      description:
        'The access token or its backing session is missing, invalid, expired, or revoked',
      schema: errorResponseSchema,
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a tutor or admin',
      schema: {
        ...errorResponseSchema,
        example: {
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
          statusCode: 403,
        },
      },
    }),
  );
}

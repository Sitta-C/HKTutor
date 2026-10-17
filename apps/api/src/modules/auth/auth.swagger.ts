import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { REFRESH_COOKIE_NAME } from '@modules/auth/auth.constants';

import type { HeaderObject, SchemaObject } from '@nestjs/swagger';

export const JWT_BEARER_AUTH = 'jwt-bearer';
export const REFRESH_COOKIE_AUTH = 'refresh-cookie';

export function AuthControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('authentication'));
}

const errorSchema: SchemaObject = {
  example: {
    error: 'Bad Request',
    message: 'Request could not be completed',
    statusCode: 400,
  },
  properties: {
    error: { example: 'Bad Request', type: 'string' },
    message: {
      oneOf: [
        { example: 'Request could not be completed', type: 'string' },
        { example: ['email must be an email'], items: { type: 'string' }, type: 'array' },
      ],
    },
    statusCode: { example: 400, type: 'integer' },
  },
  required: ['message', 'statusCode'],
  type: 'object',
};

const publicUserSchema: SchemaObject = {
  example: {
    email: 'student@example.com',
    id: '018f47a8-31c4-7e89-b486-1e86046a5c32',
    role: 'STUDENT',
  },
  properties: {
    email: { example: 'student@example.com', format: 'email', type: 'string' },
    id: { example: '018f47a8-31c4-7e89-b486-1e86046a5c32', format: 'uuid', type: 'string' },
    role: { enum: ['STUDENT', 'TUTOR', 'ADMIN'], example: 'STUDENT', type: 'string' },
  },
  required: ['id', 'email', 'role'],
  type: 'object',
};

const authResponseSchema: SchemaObject = {
  example: {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.demo.signature',
    expiresIn: 900,
    user: {
      email: 'student@example.com',
      id: '018f47a8-31c4-7e89-b486-1e86046a5c32',
      role: 'STUDENT',
    },
  },
  properties: {
    accessToken: {
      description: 'Short-lived JWT access token. The refresh token is not returned in JSON.',
      type: 'string',
    },
    expiresIn: { description: 'Access-token lifetime in seconds', example: 900, type: 'integer' },
    user: publicUserSchema,
  },
  required: ['accessToken', 'expiresIn', 'user'],
  type: 'object',
};

const refreshCookieHeader: Record<string, HeaderObject> = {
  'Set-Cookie': {
    description: `${REFRESH_COOKIE_NAME} rotating refresh token; HttpOnly and unavailable to browser JavaScript`,
    schema: {
      example: `${REFRESH_COOKIE_NAME}=<opaque-jwt>; HttpOnly; Path=/; SameSite=Lax`,
      type: 'string',
    },
  },
};

const rateLimitResponse = ApiResponse({
  description: 'Too many requests for this authentication operation',
  schema: errorSchema,
  status: 429,
});

const emailFlowSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'email', 'purpose', 'resendAvailableAt', 'retryAfterSeconds'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    purpose: { type: 'string', enum: ['verification', 'password-reset'] },
    resendAvailableAt: { type: 'string', format: 'date-time' },
    retryAfterSeconds: { type: 'integer', minimum: 0, maximum: 60 },
  },
};
const emailRequestSchema: SchemaObject = {
  type: 'object',
  required: ['message', 'emailFlow'],
  properties: { message: { type: 'string' }, emailFlow: emailFlowSchema },
};
const resendBodySchema: SchemaObject = {
  type: 'object',
  required: ['flowId'],
  additionalProperties: false,
  properties: {
    flowId: {
      type: 'string',
      format: 'uuid',
      description: 'ID returned by the current signed email flow; email input is rejected',
    },
  },
};

export function RegisterAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      description:
        'Always returns the same accepted result for new and existing emails so account existence is not disclosed.',
      summary: 'Register with email and password',
    }),
    ApiBody({
      schema: {
        example: {
          consent: true,
          email: 'student@example.com',
          password: 'password123',
          policyVersion: '2026-09-30',
          role: 'student',
        },
        properties: {
          consent: { example: true, type: 'boolean' },
          email: { example: 'student@example.com', format: 'email', type: 'string' },
          password: {
            description: '10–128 characters containing at least one letter and one number',
            example: 'password123',
            format: 'password',
            type: 'string',
          },
          policyVersion: { enum: ['2026-09-30'], type: 'string' },
          role: { enum: ['student', 'tutor'], type: 'string' },
        },
        required: ['email', 'password', 'role', 'consent', 'policyVersion'],
        type: 'object',
      },
    }),
    ApiCreatedResponse({
      description:
        'Generic registration result; HttpOnly verification-flow cookie is set for all accepted registrations',
      schema: emailRequestSchema,
    }),
    ApiBadRequestResponse({
      description: 'Registration data or consent is invalid',
      schema: errorSchema,
    }),
    ApiServiceUnavailableResponse({
      description: 'The verification email provider could not accept the message',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function VerifyEmailAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Verify an email address and start a session',
      description:
        'Consumes a single-use email verification token (only its SHA-256 hash is stored), sets emailVerifiedAt, returns a short-lived access token and sets the rotating HttpOnly refresh cookie. Invalid, expired or already-used tokens return 400 and create no session.',
    }),
    ApiBody({
      schema: {
        example: { token: 'random-verification-token-from-email' },
        properties: {
          token: {
            description: 'Opaque one-time token from the verification link; this is not a JWT',
            minLength: 32,
            type: 'string',
          },
        },
        required: ['token'],
        type: 'object',
      },
    }),
    ApiOkResponse({
      description: 'Email verified; access token returned and refresh cookie set',
      headers: refreshCookieHeader,
      schema: authResponseSchema,
    }),
    ApiBadRequestResponse({
      description: 'Verification link is invalid or expired',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function ResendVerificationAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Send a new email verification link',
      description:
        'Uses the email bound to the HttpOnly verification-flow cookie, never a caller-provided email. Requires a matching flow ID and a 60-second cooldown. Account eligibility is not disclosed. Cookies rotate even if delivery fails.',
    }),
    ApiCookieAuth('verification-flow'),
    ApiBody({ schema: resendBodySchema }),
    ApiOkResponse({
      description: 'Generic verification-email result and updated cooldown',
      schema: emailRequestSchema,
    }),
    ApiBadRequestResponse({
      description: 'Missing, expired, tampered or changed flow, or invalid body',
      schema: errorSchema,
    }),
    ApiServiceUnavailableResponse({
      description: 'Delivery failed; refresh flow status for its reserved cooldown',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function ResendPasswordResetAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Resend the password reset email to the original address',
      description:
        'Requires the HttpOnly password-reset-flow cookie and matching ID. Rejects replacement email fields. Enforces 60 seconds between accepted requests; issuing a new initial request cannot bypass the database account cooldown.',
    }),
    ApiCookieAuth('password-reset-flow'),
    ApiBody({ schema: resendBodySchema }),
    ApiOkResponse({
      description: 'Generic reset-email result and updated cooldown',
      schema: emailRequestSchema,
    }),
    ApiBadRequestResponse({
      description: 'Missing, expired, tampered or changed flow, or invalid body',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function EmailFlowAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Read the current signed email request and remaining resend wait',
      description:
        'Returns only cookie-bound flow information, with Cache-Control: no-store. This never queries account existence. Flow cookies expire after 24 hours.',
    }),
    ApiQuery({ name: 'purpose', enum: ['verification', 'password-reset'], required: true }),
    ApiOkResponse({
      description: 'Current email and server-calculated remaining wait',
      schema: emailFlowSchema,
    }),
    ApiBadRequestResponse({
      description: 'Invalid purpose or unavailable signed flow',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function LoginAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Sign in with email and password',
      description:
        'Argon2id password check for an active account with a verified email. Returns a short-lived access token and sets the rotating HttpOnly refresh cookie; the access token stays in browser memory only.',
    }),
    ApiBody({
      schema: {
        example: { email: 'admin@example.com', password: 'admin12345' },
        properties: {
          email: { example: 'admin@example.com', format: 'email', type: 'string' },
          password: { example: 'admin1234', format: 'password', type: 'string' },
        },
        required: ['email', 'password'],
        type: 'object',
      },
    }),
    ApiOkResponse({
      description: 'Signed in; access token returned and refresh cookie set',
      headers: refreshCookieHeader,
      schema: authResponseSchema,
    }),
    ApiBadRequestResponse({ description: 'Login data failed validation', schema: errorSchema }),
    ApiUnauthorizedResponse({ description: 'Email or password is incorrect', schema: errorSchema }),
    ApiForbiddenResponse({
      description: 'Account is inactive or its email has not been verified',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function RefreshAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Rotate the refresh session and issue a new access token',
      description:
        'Uses the HttpOnly refresh cookie only. Each refresh rotates the session; presenting an already-rotated token is treated as reuse and revokes the session.',
    }),
    ApiCookieAuth(REFRESH_COOKIE_AUTH),
    ApiOkResponse({
      description: 'Session rotated; access token returned and refresh cookie replaced',
      headers: refreshCookieHeader,
      schema: authResponseSchema,
    }),
    ApiUnauthorizedResponse({
      description: 'Refresh cookie is missing, invalid, expired, or reused',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function LogoutAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Revoke the current refresh session',
      description:
        'Idempotent: revokes the session behind the refresh cookie when one is present and always clears the cookie. Later protected requests with that session return 401.',
    }),
    ApiCookieAuth(REFRESH_COOKIE_AUTH),
    ApiNoContentResponse({
      description: 'Session revoked when present and refresh cookie cleared',
      headers: {
        'Set-Cookie': {
          description: `Expired ${REFRESH_COOKIE_NAME} cookie`,
          schema: { type: 'string' },
        },
      },
    }),
  );
}

export function AcceptPrivacyNoticeAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Accept the current privacy notice',
      description:
        'Records consentAcceptedAt and the policy version for the signed-in user. consent must be true and policyVersion must be a supported version.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({ description: 'Current consent version recorded for the signed-in user' }),
    ApiBadRequestResponse({
      description: 'consent is false or not a boolean, or policyVersion is not a supported version',
      schema: errorSchema,
    }),
    ApiUnauthorizedResponse({
      description: 'Access token or its backing session is missing, invalid, expired, or revoked',
      schema: errorSchema,
    }),
  );
}

export function GetCurrentUserAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Return the user authenticated by the access token',
      description:
        'Returns the id, email and role derived from the access token and its active session; never from client-supplied IDs.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({ description: 'Current authenticated user', schema: publicUserSchema }),
    ApiUnauthorizedResponse({
      description: 'Access token or its backing session is missing, invalid, expired, or revoked',
      schema: errorSchema,
    }),
  );
}

export function ForgotPasswordAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Request a password reset email',
      description:
        'Returns the same result for unknown, ineligible and eligible accounts. Account lookup and delivery are asynchronous and best effort; processing failures do not disclose account existence. At most one email per account per minute. A new link invalidates older reset links.',
    }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
        },
      },
    }),
    ApiOkResponse({
      description:
        'Generic password-reset request result; HttpOnly password-reset-flow cookie is set regardless of account eligibility',
      schema: emailRequestSchema,
    }),
    ApiBadRequestResponse({ description: 'Email format is invalid', schema: errorSchema }),
    rateLimitResponse,
  );
}

export function ResetPasswordAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Set a new password using a one-time reset link',
      description:
        'Consumes a separate opaque reset token for an active, verified account. Atomically changes the password, invalidates outstanding reset/verification links and revokes all sessions. Does not sign in or change email verification status.',
    }),
    ApiBody({
      schema: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: {
            type: 'string',
            pattern: '^[A-Za-z0-9_-]{43}$',
            description:
              'One-time token from the reset email (not a JWT or email-verification token)',
          },
          password: {
            type: 'string',
            format: 'password',
            minLength: 10,
            maxLength: 128,
            description: 'Must contain at least one letter and one number',
          },
        },
      },
    }),
    ApiOkResponse({
      description: 'Password changed; sign in again',
      schema: {
        type: 'object',
        required: ['message'],
        properties: { message: { type: 'string' } },
        example: { message: 'Password reset successfully. Sign in with your new password.' },
      },
    }),
    ApiBadRequestResponse({
      description: 'Invalid data or invalid, expired or already-used reset token',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

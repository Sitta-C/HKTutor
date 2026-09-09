import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { REFRESH_COOKIE_NAME } from '@/auth/auth.constants';

import type { HeaderObject, SchemaObject } from '@nestjs/swagger';

export const JWT_BEARER_AUTH = 'jwt-bearer';
export const REFRESH_COOKIE_AUTH = 'refresh-cookie';

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

export function RegisterAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Register with email and password' }),
    ApiBody({
      schema: {
        example: {
          consent: true,
          email: 'student@example.com',
          password: 'password123',
          policyVersion: '2026-09-08',
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
          policyVersion: { enum: ['2026-09-08'], type: 'string' },
          role: { enum: ['student', 'tutor'], type: 'string' },
        },
        required: ['email', 'password', 'role', 'consent', 'policyVersion'],
        type: 'object',
      },
    }),
    ApiCreatedResponse({
      description: 'Account created and verification email accepted for delivery',
      schema: {
        example: { message: 'Check your email to verify your account.' },
        properties: { message: { type: 'string' } },
        required: ['message'],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'Registration data or consent is invalid',
      schema: errorSchema,
    }),
    ApiConflictResponse({
      description: 'An active account already uses this email',
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
    ApiOperation({ summary: 'Verify an email address and start a session' }),
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
      description: 'Always returns a generic result so account existence is not disclosed.',
      summary: 'Send a new email verification link',
    }),
    ApiBody({
      schema: {
        example: { email: 'student@example.com' },
        properties: {
          email: { example: 'student@example.com', format: 'email', type: 'string' },
        },
        required: ['email'],
        type: 'object',
      },
    }),
    ApiOkResponse({
      description: 'Generic verification-email result',
      schema: {
        example: {
          message: 'If the account can be verified, a verification email has been sent.',
        },
        properties: { message: { type: 'string' } },
        required: ['message'],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({ description: 'Email format is invalid', schema: errorSchema }),
    ApiServiceUnavailableResponse({
      description: 'The email provider could not accept the message for an eligible account',
      schema: errorSchema,
    }),
    rateLimitResponse,
  );
}

export function LoginAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Sign in with email and password' }),
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
    ApiOperation({ summary: 'Rotate the refresh session and issue a new access token' }),
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
    ApiOperation({ summary: 'Revoke the current refresh session' }),
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

export function GetCurrentUserAuthDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Return the user authenticated by the access token' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({ description: 'Current authenticated user', schema: publicUserSchema }),
    ApiUnauthorizedResponse({
      description: 'Access token or its backing session is missing, invalid, expired, or revoked',
      schema: errorSchema,
    }),
  );
}

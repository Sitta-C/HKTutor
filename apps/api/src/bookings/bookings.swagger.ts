import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { BookingResponseDto, CreateBookingDto } from '@/bookings/bookings.dto';

export function CreateBookingDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(CreateBookingDto, BookingResponseDto),
    ApiOperation({ summary: 'Create booking' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiCreatedResponse({
      description: 'The slot was reserved for the student in a single transaction',
      schema: {
        example: {
          createdAt: '2026-09-10T09:04:31.001Z',
          currency: 'THB',
          discountAmount: '0.00',
          id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
          netAmount: '450.00',
          slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
          status: 'PENDING',
          subtotalAmount: '450.00',
        },
        items: { $ref: getSchemaPath(BookingResponseDto) },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description:
        'A required booking field failed validation, the slot has already started, or the tutor tried to book their own slot',
      schema: {
        example: {
          error: 'Bad Request',
          message: ['slotId must be a UUID'],
          statusCode: 400,
        },
        type: 'object',
      },
    }),
    ApiUnauthorizedResponse({
      description:
        'The access token or its backing session is missing, invalid, expired, or revoked',
      schema: {
        example: {
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'The referenced listing or slot does not exist',
      schema: {
        example: {
          error: 'Not Found',
          message: 'The selected slot does not exist.',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description: 'The requested slot is already booked, unavailable, or the listing/slot tutor mismatch',
      schema: {
        example: {
          error: 'Conflict',
          message: 'The selected slot is already booked.',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description:
        'The authenticated user is not a student, or active-student validation failed for the booking request',
      schema: {
        example: {
          error: 'Forbidden',
          message: 'Only active students can create bookings.',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
  );
}

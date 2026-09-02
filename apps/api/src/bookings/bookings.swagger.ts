import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiOperation,
  getSchemaPath,
} from '@nestjs/swagger';

import { BookingResponseDto, CreateBookingDto } from '@/bookings/bookings.dto';

export function CreateBookingDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(CreateBookingDto, BookingResponseDto),
    ApiOperation({ summary: 'Create booking' }),
    ApiCreatedResponse({
      description: 'The slot was reserved for the student in a single transaction',
      schema: {
        example: {
          currency: 'THB',
          discountAmount: 0,
          id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
          netAmount: 500,
          slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
          status: 'pending',
          studentUserId: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
          subtotalAmount: 500,
          tutorProfileId: '6bb01222-1fce-4bc3-a69d-3d90db2fdf57',
        },
        items: { $ref: getSchemaPath(BookingResponseDto) },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'A required booking field failed validation',
      schema: {
        example: {
          error: 'Bad Request',
          message: ['studentUserId is required'],
          statusCode: 400,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description: 'The requested slot is already booked or no longer available',
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
      description: 'Active student validation failed for the booking request',
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

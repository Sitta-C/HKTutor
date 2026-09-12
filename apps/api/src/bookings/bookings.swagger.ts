import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import {
  BookingDetailResponseDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  CreateBookingDto,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MyBookingsResponseDto,
  TutorBookingsResponseDto,
} from '@/bookings/bookings.dto';
import { BookingStatus } from '@/generated/prisma/enums';

export function BookingsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('bookings'));
}

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
        allOf: [{ $ref: getSchemaPath(BookingResponseDto) }],
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
      description:
        'The requested slot is already booked, unavailable, or the listing/slot tutor mismatch',
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

export function GetBookingQuoteDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(GetBookingQuoteQueryDto, BookingQuoteResponseDto),
    ApiOperation({ summary: 'Get an authoritative booking quote' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiQuery({
      example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
      name: 'listingId',
      required: true,
      type: String,
    }),
    ApiQuery({
      example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
      name: 'slotId',
      required: true,
      type: String,
    }),
    ApiOkResponse({
      description:
        'Server-authoritative pricing and availability preview; no booking is created and no slot is reserved',
      schema: {
        example: {
          currency: 'THB',
          discountAmount: '0.00',
          listing: {
            description: 'One-on-one algebra and calculus tutoring.',
            gradeLevelId: '095a49be-500a-4e17-85c8-2c56dd8d8c9f',
            gradeLevelName: 'Grade 10',
            id: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
            pricePerHour: '450.00',
            subjectId: 'd1136608-6be5-463f-be15-2b54a376b8d4',
            subjectName: 'Mathematics',
          },
          netAmount: '450.00',
          slot: {
            endAtUtc: '2026-09-15T11:04:06.784Z',
            id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
            startAtUtc: '2026-09-15T10:04:06.784Z',
          },
          subtotalAmount: '450.00',
          tutor: {
            displayName: 'Anan Suksawat',
            tutorId: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
          },
        },
        allOf: [{ $ref: getSchemaPath(BookingQuoteResponseDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'listingId or slotId failed validation',
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
    ApiForbiddenResponse({
      description:
        'The authenticated user is not a student, or active-student validation failed for the quote request',
      schema: {
        example: {
          error: 'Forbidden',
          message: 'Only active students can request a quote.',
          statusCode: 403,
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
      description: 'The slot is unavailable, or the listing/slot tutor mismatch',
      schema: {
        example: {
          error: 'Conflict',
          message: 'The selected slot is already booked.',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

export function GetMyBookingsDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(GetMyBookingsQueryDto, MyBookingsResponseDto),
    ApiOperation({ summary: "List the authenticated student's bookings" }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiQuery({
      enum: BookingStatus,
      example: BookingStatus.CONFIRMED,
      name: 'status',
      required: false,
    }),
    ApiQuery({
      example: '2026-09-01T00:00:00.000Z',
      name: 'from',
      required: false,
      type: String,
    }),
    ApiQuery({
      example: '2026-09-30T23:59:59.999Z',
      name: 'to',
      required: false,
      type: String,
    }),
    ApiOkResponse({
      description:
        "The authenticated student's own bookings, optionally filtered by status and/or session date range",
      schema: {
        example: {
          items: [
            {
              createdAt: '2026-09-10T09:04:31.001Z',
              currency: 'THB',
              discountAmount: '0.00',
              id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
              listing: {
                description: 'One-on-one algebra and calculus tutoring.',
                gradeLevelId: '095a49be-500a-4e17-85c8-2c56dd8d8c9f',
                gradeLevelName: 'Grade 10',
                id: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
                pricePerHour: '450.00',
                subjectId: 'd1136608-6be5-463f-be15-2b54a376b8d4',
                subjectName: 'Mathematics',
              },
              netAmount: '450.00',
              slot: {
                endAtUtc: '2026-09-15T11:04:06.784Z',
                id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
                startAtUtc: '2026-09-15T10:04:06.784Z',
              },
              status: 'PENDING',
              subtotalAmount: '450.00',
              tutor: {
                displayName: 'Anan Suksawat',
                tutorId: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
              },
            },
          ],
          total: 1,
        },
        allOf: [{ $ref: getSchemaPath(MyBookingsResponseDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'status, from, or to failed validation, or from is later than to',
      schema: {
        example: {
          error: 'Bad Request',
          message: ['from must not be later than to'],
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
    ApiForbiddenResponse({
      description: 'The authenticated user is not a student',
      schema: {
        example: {
          error: 'Forbidden',
          message: 'Forbidden resource',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
  );
}

export function GetMyBookingDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(BookingDetailResponseDto),
    ApiOperation({ summary: "Get one of the authenticated student's bookings by ID" }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({
      description:
        "The authenticated student's own booking, including tutor, listing, slot, status, amount snapshot, and timestamps",
      schema: {
        example: {
          createdAt: '2026-09-10T09:04:31.001Z',
          currency: 'THB',
          discountAmount: '0.00',
          id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          listing: {
            description: 'One-on-one algebra and calculus tutoring.',
            gradeLevelId: '095a49be-500a-4e17-85c8-2c56dd8d8c9f',
            gradeLevelName: 'Grade 10',
            id: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
            pricePerHour: '450.00',
            subjectId: 'd1136608-6be5-463f-be15-2b54a376b8d4',
            subjectName: 'Mathematics',
          },
          netAmount: '450.00',
          slot: {
            endAtUtc: '2026-09-15T11:04:06.784Z',
            id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
            startAtUtc: '2026-09-15T10:04:06.784Z',
          },
          status: 'PENDING',
          subtotalAmount: '450.00',
          tutor: {
            displayName: 'Anan Suksawat',
            tutorId: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
          },
          updatedAt: '2026-09-10T09:04:31.001Z',
        },
        allOf: [{ $ref: getSchemaPath(BookingDetailResponseDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'bookingId is not a valid UUID',
      schema: {
        example: {
          code: 'INVALID_UUID',
          error: 'Bad Request',
          message: 'bookingId must be a valid UUID',
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
    ApiForbiddenResponse({
      description: 'The authenticated user is not a student',
      schema: {
        example: {
          error: 'Forbidden',
          message: 'Forbidden resource',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description:
        'The booking does not exist, or exists but does not belong to the authenticated student (ownership-safe: identical response either way)',
      schema: {
        example: {
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
  );
}

export function GetTutorBookingsDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(GetTutorBookingsQueryDto, TutorBookingsResponseDto),
    ApiOperation({ summary: "List the authenticated tutor's assigned bookings" }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiQuery({
      enum: BookingStatus,
      example: BookingStatus.CONFIRMED,
      name: 'status',
      required: false,
    }),
    ApiQuery({
      example: '2026-09-01T00:00:00.000Z',
      name: 'from',
      required: false,
      type: String,
    }),
    ApiQuery({
      example: '2026-09-30T23:59:59.999Z',
      name: 'to',
      required: false,
      type: String,
    }),
    ApiOkResponse({
      description:
        "The authenticated tutor's assigned bookings, optionally filtered by status and/or session date range. Participant identity is limited to the student's nickname.",
      schema: {
        example: {
          items: [
            {
              createdAt: '2026-09-10T09:04:31.001Z',
              currency: 'THB',
              discountAmount: '0.00',
              id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
              listing: {
                description: 'One-on-one algebra and calculus tutoring.',
                gradeLevelId: '095a49be-500a-4e17-85c8-2c56dd8d8c9f',
                gradeLevelName: 'Grade 10',
                id: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
                pricePerHour: '450.00',
                subjectId: 'd1136608-6be5-463f-be15-2b54a376b8d4',
                subjectName: 'Mathematics',
              },
              netAmount: '450.00',
              slot: {
                endAtUtc: '2026-09-15T11:04:06.784Z',
                id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
                startAtUtc: '2026-09-15T10:04:06.784Z',
              },
              status: 'PENDING',
              student: { nickname: 'Nan' },
              subtotalAmount: '450.00',
            },
          ],
          total: 1,
        },
        allOf: [{ $ref: getSchemaPath(TutorBookingsResponseDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'status, from, or to failed validation, or from is later than to',
      schema: {
        example: {
          error: 'Bad Request',
          message: ['from must not be later than to'],
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
    ApiForbiddenResponse({
      description: 'The authenticated user is not a tutor',
      schema: {
        example: {
          error: 'Forbidden',
          message: 'Forbidden resource',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
  );
}

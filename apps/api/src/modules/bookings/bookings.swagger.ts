import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
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

import { AttendanceStatus, BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import {
  BookingClassDetailDto,
  BookingDetailResponseDto,
  BookingMeetingLinkDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  BookingSlotStatus,
  CancelBookingDto,
  CanceledBookingDto,
  ClassAttendanceResponseDto,
  ConfirmBookingDto,
  CreateBookingDto,
  CreateMockPaymentDto,
  MockPaymentResponseDto,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MyBookingsResponseDto,
  RejectBookingDto,
  TutorBookingActionResponseDto,
  TutorBookingsResponseDto,
  UpdateAttendanceDto,
  UpdateMeetingLinkDto,
} from '@modules/bookings/bookings.dto';

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
      description: 'A required booking field failed validation',
      schema: {
        example: {
          code: 'VALIDATION_FAILED',
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
          code: 'UNAUTHENTICATED',
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
          code: 'NOT_FOUND',
          error: 'Not Found',
          message: 'The selected slot does not exist.',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'The requested slot is already booked, has already started, or is no longer available; the listing is unpublished or its tutor does not match the slot; or the tutor is not verified',
      schema: {
        example: {
          code: 'CONFLICT',
          error: 'Conflict',
          message: 'The selected slot is already booked.',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description:
        'The authenticated user is not a student (a tutor booking their own slot is rejected here), active-student validation failed, or the student profile is incomplete',
      schema: {
        example: {
          code: 'FORBIDDEN',
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
          code: 'VALIDATION_FAILED',
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
          code: 'UNAUTHENTICATED',
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description:
        'The authenticated user is not a student, active-student validation failed, or the student profile is incomplete',
      schema: {
        example: {
          code: 'FORBIDDEN',
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
          code: 'NOT_FOUND',
          error: 'Not Found',
          message: 'The selected slot does not exist.',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'The slot is already booked, has already started, or is no longer available; the listing is unpublished or its tutor does not match the slot; or the tutor is not verified',
      schema: {
        example: {
          code: 'CONFLICT',
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
          code: 'VALIDATION_FAILED',
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
          code: 'UNAUTHENTICATED',
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
          code: 'FORBIDDEN',
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
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
          code: 'UNAUTHENTICATED',
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
          code: 'FORBIDDEN',
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
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
          code: 'NOT_FOUND',
          error: 'Not Found',
          message: 'Resource not found',
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
          code: 'VALIDATION_FAILED',
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
          code: 'UNAUTHENTICATED',
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
          code: 'FORBIDDEN',
          error: 'Forbidden',
          message: 'You do not have permission to access this resource',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
  );
}

/** Confirm and reject share one error contract, including the `code` field clients switch on. */
function tutorBookingActionErrorResponses(): MethodDecorator[] {
  return [
    ApiBadRequestResponse({
      description: 'bookingId is not a valid UUID, or the request body failed validation',
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
          code: 'UNAUTHENTICATED',
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a tutor, or the booking belongs to another tutor',
      schema: {
        example: {
          code: 'BOOKING_NOT_OWNED',
          error: 'Forbidden',
          message: 'This booking belongs to another tutor',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'No booking exists with this ID',
      schema: {
        example: {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'The booking is no longer pending (already confirmed, canceled, completed or expired), or a concurrent confirm/reject won the transition',
      schema: {
        example: {
          code: 'BOOKING_NOT_PENDING',
          error: 'Conflict',
          message: 'Only a pending booking can be confirmed or rejected; this booking is CONFIRMED',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  ];
}

export function ConfirmTutorBookingDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ConfirmBookingDto, TutorBookingActionResponseDto),
    ApiOperation({ summary: "Confirm one of the authenticated tutor's pending bookings" }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiBody({ required: false, type: ConfirmBookingDto }),
    ApiOkResponse({
      description:
        'The pending booking became confirmed in one conditional update; the slot stays reserved',
      schema: {
        example: {
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          canceledAt: null,
          slotStatus: BookingSlotStatus.RESERVED,
          status: BookingStatus.CONFIRMED,
        },
        allOf: [{ $ref: getSchemaPath(TutorBookingActionResponseDto) }],
        type: 'object',
      },
    }),
    ...tutorBookingActionErrorResponses(),
  );
}

export function RejectTutorBookingDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(RejectBookingDto, TutorBookingActionResponseDto),
    ApiOperation({ summary: "Reject one of the authenticated tutor's pending bookings" }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiBody({ required: false, type: RejectBookingDto }),
    ApiOkResponse({
      description:
        'The pending booking became canceled and released its slot in the same transaction',
      schema: {
        example: {
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          canceledAt: '2026-10-04T09:04:31.001Z',
          slotStatus: BookingSlotStatus.AVAILABLE,
          status: BookingStatus.CANCELED,
        },
        allOf: [{ $ref: getSchemaPath(TutorBookingActionResponseDto) }],
        type: 'object',
      },
    }),
    ...tutorBookingActionErrorResponses(),
  );
}

function mockPaymentErrorResponses(): MethodDecorator[] {
  return [
    ApiBadRequestResponse({
      description:
        'bookingId is not a valid UUID, the body failed validation, or the declared amount does ' +
        "not match the booking's stored amount; also returned for PENDING (BOOKING_NOT_PAYABLE)",
      schema: {
        example: {
          code: 'BOOKING_PAYMENT_AMOUNT_MISMATCH',
          details: { expectedAmount: '450.00' },
          error: 'Bad Request',
          message: 'amount does not match the amount recorded for this booking',
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
          code: 'UNAUTHENTICATED',
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description:
        'The authenticated user is not a student, or the booking belongs to another student',
      schema: {
        example: {
          code: 'BOOKING_NOT_OWNED',
          error: 'Forbidden',
          message: 'This booking belongs to another student',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'No booking exists with this ID',
      schema: {
        example: {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'The booking is canceled, completed or expired, is already paid, the reference belongs to another ' +
        'booking, or a concurrent payment won the transition',
      schema: {
        example: {
          code: 'BOOKING_ALREADY_PAID',
          error: 'Conflict',
          message: 'This booking is already paid',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  ];
}

export function CreateMockPaymentDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(CreateMockPaymentDto, MockPaymentResponseDto),
    ApiOperation({
      summary: "Record the demo payment for one of the authenticated student's confirmed bookings",
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiBody({ required: true, type: CreateMockPaymentDto }),
    ApiOkResponse({
      description:
        "The confirmed, unpaid booking became paid in one conditional update, storing the server's " +
        'amount, the paid timestamp and the globally unique demo reference',
      schema: {
        example: {
          amount: '450.00',
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          paidAt: '2026-10-09T09:04:31.001Z',
          paymentStatus: PaymentStatus.PAID,
          reference: 'DEMO-7F3A91',
        },
        allOf: [{ $ref: getSchemaPath(MockPaymentResponseDto) }],
        type: 'object',
      },
    }),
    ...mockPaymentErrorResponses(),
  );
}

export function UpdateMeetingLinkDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(UpdateMeetingLinkDto, BookingMeetingLinkDto),
    ApiOperation({
      summary:
        "Update the meeting link for one of the authenticated tutor's confirmed or completed bookings",
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiBody({ required: true, type: UpdateMeetingLinkDto }),
    ApiOkResponse({
      description: 'The booking meeting URL was updated successfully',
      schema: {
        example: {
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
          updatedAt: '2026-10-09T09:04:31.001Z',
        },
        allOf: [{ $ref: getSchemaPath(BookingMeetingLinkDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description:
        'bookingId is not a valid UUID, the request body failed validation, or the meeting URL is invalid',
      schema: {
        example: {
          code: 'INVALID_URL',
          error: 'Bad Request',
          message: 'The given URL is invalid',
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
          code: 'UNAUTHENTICATED',
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a tutor, or the booking belongs to another tutor',
      schema: {
        example: {
          code: 'BOOKING_NOT_OWNED',
          error: 'Forbidden',
          message: 'This booking belongs to another tutor',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'No booking exists with this ID',
      schema: {
        example: {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'The booking is not confirmed or completed (pending, canceled or expired), or a concurrent transition modified the booking status',
      schema: {
        example: {
          code: 'BOOKING_NOT_CONFIRMED_OR_COMPLETED',
          error: 'Conflict',
          message:
            'Only a confirmed or completed booking can have its meeting link updated; this booking is PENDING',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

export function GetBookingClassDetailDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(BookingClassDetailDto),
    ApiOperation({ summary: 'Get class details for a booking participant' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOkResponse({
      description:
        'Schedule, subject, attendance with its original recording time, and participant profiles for every booking state. ' +
        'meetingUrl is null when missing or outside CONFIRMED/COMPLETED.',
      schema: {
        example: {
          attendance: null,
          attendanceMarkedAt: null,
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          endAt: '2026-10-09T10:00:00.000Z',
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
          participants: {
            student: {
              detail: {
                firstName: 'Suda',
                gradeLevel: 'Grade 10',
                lastName: 'Dee',
                nickname: 'Da',
                phone: '0812345678',
                school: 'Demo School',
              },
              id: '6bb01222-1fce-4bc3-a69d-3d90db2fdf57',
            },
            tutor: {
              detail: {
                bio: 'Experienced math tutor',
                displayName: 'Anan Suksawat',
                experienceYears: 5,
                firstName: 'Anan',
                lastName: 'Suksawat',
                nickname: 'Nan',
              },
              id: '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857',
            },
          },
          startAt: '2026-10-09T09:00:00.000Z',
          status: 'CONFIRMED',
          subject: { id: '11dafbfa-89bc-4e09-a89a-873c419140bd', name: 'Mathematics' },
        },
        allOf: [{ $ref: getSchemaPath(BookingClassDetailDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'bookingId is not a valid UUID, or the student profile is missing',
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
          code: 'UNAUTHENTICATED',
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a participant in this booking',
      schema: {
        example: {
          code: 'BOOKING_NOT_OWNED',
          error: 'Forbidden',
          message: 'You are not a participant in this booking',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'No booking exists with this ID',
      schema: {
        example: {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
  );
}

export function CancelBookingDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(CancelBookingDto, CanceledBookingDto),
    ApiOperation({ summary: 'Cancel a booking' }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiBody({ required: true, type: CancelBookingDto }),
    ApiOkResponse({
      description: 'The booking was canceled successfully',
      schema: {
        example: {
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          canceledAt: '2026-10-09T09:04:31.001Z',
          status: BookingStatus.CANCELED,
        },
        allOf: [{ $ref: getSchemaPath(CanceledBookingDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'The booking ID is not a valid UUID or the cancellation reason is empty/missing',
      schema: {
        example: {
          code: 'REASON_MISSING',
          error: 'Bad Request',
          message: 'Reason cannot be empty!',
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
          code: 'UNAUTHENTICATED',
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a participant in this booking',
      schema: {
        example: {
          code: 'BOOKING_NOT_OWNED',
          error: 'Forbidden',
          message: 'This booking belongs to another user',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'No booking exists with this ID',
      schema: {
        example: {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'The booking is already paid, already in a final state (completed, canceled, or expired), ' +
        'is inside the 24-hour cutoff before class start, or a concurrent update changed its slot/state',
      schema: {
        example: {
          code: 'BOOKING_ALREADY_PAID',
          error: 'Conflict',
          message: 'This booking is already paid',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

export function UpdateAttendanceDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(UpdateAttendanceDto, ClassAttendanceResponseDto),
    ApiOperation({
      summary:
        "Update the attendance for one of the authenticated tutor's confirmed or completed bookings",
      description:
        'Record ATTENDED or ABSENT when the class end time is at or before now. The first write completes the booking atomically, whichever value is recorded. A same-value replay returns the saved timestamp without writing; a different value returns 409. A still-pending booking returns 400; canceled and expired bookings return 409.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiBody({ required: true, type: UpdateAttendanceDto }),
    ApiOkResponse({
      description:
        'Attendance recorded with idempotentReplay=false, or the saved record returned with idempotentReplay=true',
      schema: {
        example: {
          attendance: AttendanceStatus.ATTENDED,
          attendanceMarkedAt: '2026-10-09T09:04:31.001Z',
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          idempotentReplay: false,
          status: BookingStatus.COMPLETED,
        },
        allOf: [{ $ref: getSchemaPath(ClassAttendanceResponseDto) }],
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description:
        'The booking ID is not a valid UUID, the attendance status failed validation, or the booking is still PENDING (BOOKING_NOT_CONFIRMED_OR_COMPLETED)',
      schema: {
        example: {
          code: 'VALIDATION_FAILED',
          error: 'Bad Request',
          message: ['attendance must be one of the following values: ATTENDED, ABSENT'],
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
          code: 'UNAUTHENTICATED',
          error: 'Unauthorized',
          message: 'Invalid or expired authentication token',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'The authenticated user is not a tutor, or the booking belongs to another tutor',
      schema: {
        example: {
          code: 'BOOKING_NOT_OWNED',
          error: 'Forbidden',
          message: 'This booking belongs to another tutor',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'No booking exists with this ID',
      schema: {
        example: {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'The booking is canceled or expired, the class has not ended, attendance was recorded with a different value (ATTENDANCE_ALREADY_RECORDED), or a concurrent transition changed its eligibility',
      schema: {
        example: {
          code: 'CLASS_NOT_ENDED',
          error: 'Conflict',
          message: 'Only ended class to be updated the attendance',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import {
  ApprovedRescheduleBookingDto,
  ApproveRescheduleResponseDto,
  CreateRescheduleRequestDto,
  CreateRescheduleRequestResponseDto,
  CurrentRescheduleRequestResponseDto,
  RejectRescheduleRequestDto,
  RejectRescheduleResponseDto,
  RescheduleRequestViewDto,
  RescheduleTargetSlotDto,
  WithdrawRescheduleResponseDto,
} from '@modules/reschedule-requests/reschedule-requests.dto';

export function BookingRescheduleRequestsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('bookings'));
}

export function RescheduleRequestsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('reschedule-requests'));
}

export function CreateRescheduleRequestDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(CreateRescheduleRequestDto, CreateRescheduleRequestResponseDto),
    ApiOperation({
      summary: 'Create a booking reschedule request',
      description:
        'The current class must start at least 24 hours later; exactly 24 hours is allowed.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiParam({
      description: 'The booking UUID to reschedule',
      example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
      name: 'bookingId',
    }),
    ApiBody({ required: true, type: CreateRescheduleRequestDto }),
    ApiCreatedResponse({
      description: 'The reschedule request was created successfully',
      schema: {
        allOf: [{ $ref: getSchemaPath(CreateRescheduleRequestResponseDto) }],
        example: {
          bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
          requestId: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
          status: 'PENDING',
          targetSlotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
        },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'Invalid input, past target slot, slot overlap, or wrong tutor',
      schema: {
        example: {
          code: 'RESCHEDULE_TARGET_PAST',
          error: 'Bad Request',
          message: 'Target slot must be in the future',
          statusCode: 400,
        },
        type: 'object',
      },
    }),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid authentication token',
      schema: {
        example: {
          code: 'AUTH_REQUIRED',
          error: 'Unauthorized',
          message: 'Authentication token is missing or invalid',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'User is not a participant of this booking, or account is inactive',
      schema: {
        example: {
          code: 'BOOKING_NOT_PARTICIPANT',
          error: 'Forbidden',
          message: 'This booking belongs to another user',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'The booking or target slot was not found',
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
        'Booking inside 24-hour cutoff, booking not confirmed, duplicate pending request, or target slot already reserved',
      schema: {
        example: {
          code: 'RESCHEDULE_CUTOFF_EXCEEDED',
          error: 'Conflict',
          message:
            'Reschedule requests must be made and approved at least 24 hours before class start',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

export function GetCurrentRescheduleRequestDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(
      CurrentRescheduleRequestResponseDto,
      RescheduleRequestViewDto,
      RescheduleTargetSlotDto,
    ),
    ApiOperation({
      summary: 'Get current pending reschedule request and allowed actions for a booking',
      description:
        'CREATE includes the exact 24-hour boundary. APPROVE is returned only while the ' +
        'booking and target are eligible. Pending requests can still be rejected or withdrawn ' +
        'by the appropriate participant when approval is unavailable.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiParam({
      description: 'The booking UUID',
      example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
      name: 'bookingId',
    }),
    ApiOkResponse({
      description: 'Current reschedule request state and allowed actions',
      schema: {
        allOf: [{ $ref: getSchemaPath(CurrentRescheduleRequestResponseDto) }],
        example: {
          allowedActions: ['APPROVE', 'REJECT'],
          request: {
            bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
            decidedAt: null,
            fromSlotId: '550e8400-e29b-41d4-a716-446655440000',
            id: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
            reason: 'Schedule conflict with university exam.',
            requestedAt: '2026-10-15T12:00:00.000Z',
            requestedById: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
            requestedSlotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
            reviewedById: null,
            status: 'PENDING',
            withdrawnAt: null,
          },
          targetSlot: {
            endAtUtc: '2026-10-25T11:00:00.000Z',
            id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
            startAtUtc: '2026-10-25T10:00:00.000Z',
            tutorProfileId: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
          },
        },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'The booking ID is not a valid UUID',
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
      description: 'Missing or invalid authentication token',
      schema: {
        example: {
          code: 'AUTH_REQUIRED',
          error: 'Unauthorized',
          message: 'Authentication token is missing or invalid',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'User is not a participant of this booking',
      schema: {
        example: {
          code: 'BOOKING_NOT_PARTICIPANT',
          error: 'Forbidden',
          message: 'This booking belongs to another user',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'The booking was not found',
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

export function ApproveRescheduleRequestDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(
      ApproveRescheduleResponseDto,
      ApprovedRescheduleBookingDto,
      RescheduleTargetSlotDto,
    ),
    ApiOperation({
      summary: 'Approve a pending reschedule request and swap booking slot',
      description:
        'Locks the booking, re-reads the request, then locks and revalidates the target before ' +
        'closing the request and swapping slots in one transaction. Exactly 24 hours before ' +
        'the current class is allowed. A target deleted while waiting for the lock returns 409.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiParam({
      description: 'The reschedule request UUID',
      example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
      name: 'requestId',
    }),
    ApiOkResponse({
      description: 'The reschedule request was approved and booking slot swapped',
      schema: {
        allOf: [{ $ref: getSchemaPath(ApproveRescheduleResponseDto) }],
        example: {
          booking: {
            id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
            listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
            netAmount: '450.00',
            slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
            status: 'CONFIRMED',
            studentUserId: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
            subtotalAmount: '450.00',
            tutorProfileId: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
            updatedAt: '2026-10-15T12:30:00.000Z',
          },
          newSlot: {
            endAtUtc: '2026-10-25T11:00:00.000Z',
            id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
            startAtUtc: '2026-10-25T10:00:00.000Z',
            tutorProfileId: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
          },
          requestId: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
          status: 'APPROVED',
        },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'The request ID is not a valid UUID',
      schema: {
        example: {
          code: 'INVALID_UUID',
          error: 'Bad Request',
          message: 'requestId must be a valid UUID',
          statusCode: 400,
        },
        type: 'object',
      },
    }),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid authentication token',
      schema: {
        example: {
          code: 'AUTH_REQUIRED',
          error: 'Unauthorized',
          message: 'Authentication token is missing or invalid',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'User is the requester or not a participant in this booking',
      schema: {
        example: {
          code: 'RESCHEDULE_NOT_APPROVER',
          error: 'Forbidden',
          message: 'Only the counterparty can approve this reschedule request',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'The reschedule request was not found',
      schema: {
        example: {
          code: 'RESCHEDULE_REQUEST_NOT_FOUND',
          error: 'Not Found',
          message: 'Reschedule request not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description:
        'Request not pending, target slot reserved/unavailable, cutoff passed, or race condition',
      schema: {
        example: {
          code: 'RESCHEDULE_TARGET_RESERVED',
          error: 'Conflict',
          message: 'The target slot is already reserved by another booking',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

export function RejectRescheduleRequestDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(RejectRescheduleRequestDto, RejectRescheduleResponseDto),
    ApiOperation({
      summary: 'Reject a pending reschedule request',
      description:
        'Only the participant who did not create the request may reject it. The booking keeps its slot and the target slot is untouched (a pending request never holds it). The requester is notified.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiParam({
      description: 'The reschedule request UUID',
      example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
      name: 'requestId',
    }),
    ApiBody({ required: false, type: RejectRescheduleRequestDto }),
    ApiOkResponse({
      description: 'The reschedule request was rejected successfully',
      schema: {
        allOf: [{ $ref: getSchemaPath(RejectRescheduleResponseDto) }],
        example: {
          requestId: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
          reviewedAt: '2026-10-15T12:30:00.000Z',
          status: 'REJECTED',
        },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'Invalid input or request ID',
      schema: {
        example: {
          code: 'INVALID_UUID',
          error: 'Bad Request',
          message: 'requestId must be a valid UUID',
          statusCode: 400,
        },
        type: 'object',
      },
    }),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid authentication token',
      schema: {
        example: {
          code: 'AUTH_REQUIRED',
          error: 'Unauthorized',
          message: 'Authentication token is missing or invalid',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'User is the requester or not a participant in this booking',
      schema: {
        example: {
          code: 'RESCHEDULE_NOT_REVIEWER',
          error: 'Forbidden',
          message: 'Only the counterparty can review or reject this reschedule request',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'The reschedule request was not found',
      schema: {
        example: {
          code: 'RESCHEDULE_REQUEST_NOT_FOUND',
          error: 'Not Found',
          message: 'Reschedule request not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description: 'The reschedule request is not pending',
      schema: {
        example: {
          code: 'RESCHEDULE_REQUEST_NOT_PENDING',
          error: 'Conflict',
          message: 'Only a pending reschedule request can be acted on; this request is REJECTED',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

export function WithdrawRescheduleRequestDoc(): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(WithdrawRescheduleResponseDto),
    ApiOperation({
      summary: 'Withdraw a pending reschedule request',
      description:
        'Only the participant who created the request may withdraw it. The booking and both slots are unchanged.',
    }),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiParam({
      description: 'The reschedule request UUID',
      example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
      name: 'requestId',
    }),
    ApiOkResponse({
      description: 'The reschedule request was withdrawn successfully',
      schema: {
        allOf: [{ $ref: getSchemaPath(WithdrawRescheduleResponseDto) }],
        example: {
          requestId: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020',
          status: 'WITHDRAWN',
          withdrawnAt: '2026-10-15T12:30:00.000Z',
        },
        type: 'object',
      },
    }),
    ApiBadRequestResponse({
      description: 'The request ID is not a valid UUID',
      schema: {
        example: {
          code: 'INVALID_UUID',
          error: 'Bad Request',
          message: 'requestId must be a valid UUID',
          statusCode: 400,
        },
        type: 'object',
      },
    }),
    ApiUnauthorizedResponse({
      description: 'Missing or invalid authentication token',
      schema: {
        example: {
          code: 'AUTH_REQUIRED',
          error: 'Unauthorized',
          message: 'Authentication token is missing or invalid',
          statusCode: 401,
        },
        type: 'object',
      },
    }),
    ApiForbiddenResponse({
      description: 'User is not the original requester',
      schema: {
        example: {
          code: 'RESCHEDULE_NOT_REQUESTER',
          error: 'Forbidden',
          message: 'Only the original requester can withdraw this reschedule request',
          statusCode: 403,
        },
        type: 'object',
      },
    }),
    ApiNotFoundResponse({
      description: 'The reschedule request was not found',
      schema: {
        example: {
          code: 'RESCHEDULE_REQUEST_NOT_FOUND',
          error: 'Not Found',
          message: 'Reschedule request not found',
          statusCode: 404,
        },
        type: 'object',
      },
    }),
    ApiConflictResponse({
      description: 'The reschedule request is not pending',
      schema: {
        example: {
          code: 'RESCHEDULE_REQUEST_NOT_PENDING',
          error: 'Conflict',
          message: 'Only a pending reschedule request can be acted on; this request is WITHDRAWN',
          statusCode: 409,
        },
        type: 'object',
      },
    }),
  );
}

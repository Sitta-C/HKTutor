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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiUnauthorizedResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { ListingPublicationStatus } from '@/generated/prisma/client';
import {
  AvailabilityPostRequestDto,
  AvailabilityPostResponseDto,
  AvailabilityPrivateResponseDto,
  AvailabilityPublicResponseDto,
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingResponseDto,
  ListingStatusRequestDto,
} from '@/tutors/tutors.dto';

class ApiErrorResponseDto {
  @ApiProperty({ example: 400, type: Number })
  statusCode!: number;

  @ApiProperty({
    oneOf: [
      { example: 'Request could not be completed', type: 'string' },
      { items: { type: 'string' }, type: 'array' },
    ],
  })
  message!: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiPropertyOptional({ example: 'INVALID_UUID' })
  code?: string;
}

const unauthorizedDescription = 'A valid access token and active verified session are required';
const forbiddenDescription = 'Only a tutor can manage tutor listings';

export function TutorsControllerDoc(): ClassDecorator {
  return applyDecorators(
    ApiTags('tutors'),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiExtraModels(
      ApiErrorResponseDto,
      AvailabilityPostRequestDto,
      AvailabilityPostResponseDto,
      AvailabilityPrivateResponseDto,
      ListingPatchRequestDto,
      ListingPostRequestDto,
      ListingResponseDto,
      ListingStatusRequestDto,
    ),
  );
}

export function TutorsPublicControllerDoc(): ClassDecorator {
  return applyDecorators(
    ApiTags('tutors'),
    ApiExtraModels(ApiErrorResponseDto, AvailabilityPublicResponseDto),
  );
}

export function GetMyListingsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get the current tutor’s non-deleted listings' }),
    ApiQuery({
      enum: ListingPublicationStatus,
      enumName: 'ListingPublicationStatus',
      name: 'publicationStatus',
      required: false,
    }),
    ApiOkResponse({
      description: 'Tutor-owned listings ordered by most recently updated',
      type: [ListingResponseDto],
    }),
    ApiBadRequestResponse({
      description: 'The listing filter is invalid',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({ description: forbiddenDescription, type: ApiErrorResponseDto }),
  );
}

export function GetMyListingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get one non-deleted listing owned by the current tutor' }),
    listingIdParam(),
    ApiOkResponse({ description: 'Tutor-owned listing', type: ListingResponseDto }),
    ApiBadRequestResponse({
      description: 'The listing ID is not a valid UUID (INVALID_UUID)',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({ description: forbiddenDescription, type: ApiErrorResponseDto }),
    ApiNotFoundResponse({
      description: 'Listing not found or owned by another tutor',
      type: ApiErrorResponseDto,
    }),
  );
}

export function PostListingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Create a draft listing for the current tutor' }),
    ApiBody({ type: ListingPostRequestDto }),
    ApiCreatedResponse({ description: 'Draft listing created', type: ListingResponseDto }),
    ApiBadRequestResponse({
      description: 'The request or selected catalog value is invalid',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({ description: forbiddenDescription, type: ApiErrorResponseDto }),
  );
}

export function PatchListingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Update a non-deleted listing owned by the current tutor' }),
    listingIdParam(),
    ApiBody({
      description: 'At least one editable listing field is required',
      schema: {
        allOf: [{ $ref: getSchemaPath(ListingPatchRequestDto) }],
        minProperties: 1,
      },
    }),
    ApiOkResponse({ description: 'Listing updated', type: ListingResponseDto }),
    ApiBadRequestResponse({
      description:
        'The request, selected catalog value, or listing ID is invalid (INVALID_UUID for UUID syntax)',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({ description: forbiddenDescription, type: ApiErrorResponseDto }),
    ApiNotFoundResponse({ description: 'Listing not found', type: ApiErrorResponseDto }),
  );
}

export function PublishListingDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Publish a non-deleted listing owned by the current tutor' }),
    listingIdParam(),
    ApiOkResponse({ description: 'Listing published', type: ListingResponseDto }),
    ApiBadRequestResponse({
      description: 'The listing ID is not a valid UUID (INVALID_UUID)',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({
      description: 'The account is not a tutor or its tutor profile is not verified',
      type: ApiErrorResponseDto,
    }),
    ApiNotFoundResponse({ description: 'Listing not found', type: ApiErrorResponseDto }),
  );
}

export function UpdateListingStatusDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Change the publication status of a tutor-owned listing' }),
    listingIdParam(),
    ApiBody({ type: ListingStatusRequestDto }),
    ApiOkResponse({ description: 'Listing status updated', type: ListingResponseDto }),
    ApiBadRequestResponse({
      description: 'The publication status or listing ID is invalid (INVALID_UUID for UUID syntax)',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({
      description:
        'The account is not a tutor, or its tutor profile is not verified when publishing',
      type: ApiErrorResponseDto,
    }),
    ApiNotFoundResponse({
      description: 'Listing not found or owned by another tutor',
      type: ApiErrorResponseDto,
    }),
  );
}

export function GetMyAvailabilityDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get the current tutor’s availability slots' }),
    ...availabilityRangeQueries(),
    ApiOkResponse({
      description: 'Tutor-owned slots ordered by start time with their derived reservation state',
      type: [AvailabilityPrivateResponseDto],
    }),
    ApiBadRequestResponse({
      description: 'The date range is invalid (INVALID_TIME_RANGE)',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({ description: forbiddenDescription, type: ApiErrorResponseDto }),
  );
}

export function PostAvailabilityDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Create a future availability slot for the current tutor' }),
    ApiBody({ type: AvailabilityPostRequestDto }),
    ApiCreatedResponse({
      description: 'Availability slot created',
      type: AvailabilityPostResponseDto,
    }),
    ApiBadRequestResponse({
      description: 'The timestamps are invalid or inverted (INVALID_TIME_RANGE)',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({ description: forbiddenDescription, type: ApiErrorResponseDto }),
    ApiConflictResponse({
      description: 'The requested range overlaps an existing slot (AVAILABILITY_OVERLAP)',
      type: ApiErrorResponseDto,
    }),
  );
}

export function DeleteAvailabilityDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Soft-delete a free availability slot owned by the current tutor' }),
    ApiParam({
      description: 'Tutor-owned availability slot ID',
      format: 'uuid',
      name: 'slotId',
      type: String,
    }),
    ApiNoContentResponse({ description: 'Availability slot deleted' }),
    ApiBadRequestResponse({
      description: 'The slot ID is not a valid UUID (INVALID_UUID)',
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({ description: unauthorizedDescription, type: ApiErrorResponseDto }),
    ApiForbiddenResponse({ description: forbiddenDescription, type: ApiErrorResponseDto }),
    ApiNotFoundResponse({
      description: 'Slot not found or owned by another tutor (SLOT_NOT_FOUND)',
      type: ApiErrorResponseDto,
    }),
    ApiConflictResponse({
      description: 'The slot has a pending or confirmed booking (SLOT_RESERVED)',
      type: ApiErrorResponseDto,
    }),
  );
}

export function GetTutorAvailabilityDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get a verified tutor’s future open availability slots' }),
    ApiParam({
      description: 'Verified tutor ID',
      format: 'uuid',
      name: 'tutorId',
      type: String,
    }),
    ...availabilityRangeQueries(),
    ApiOkResponse({
      description: 'Future open slots ordered by start time',
      type: [AvailabilityPublicResponseDto],
    }),
    ApiBadRequestResponse({
      description: 'The tutor ID or date range is invalid',
      type: ApiErrorResponseDto,
    }),
    ApiNotFoundResponse({
      description: 'A verified tutor was not found (TUTOR_NOT_FOUND)',
      type: ApiErrorResponseDto,
    }),
  );
}

function availabilityRangeQueries(): MethodDecorator[] {
  return [
    ApiQuery({
      description: 'Inclusive UTC range start',
      example: '2026-10-17T00:00:00.000Z',
      format: 'date-time',
      name: 'from',
      required: false,
      type: String,
    }),
    ApiQuery({
      description: 'Exclusive UTC range end',
      example: '2026-10-18T00:00:00.000Z',
      format: 'date-time',
      name: 'to',
      required: false,
      type: String,
    }),
  ];
}

function listingIdParam(): MethodDecorator {
  return ApiParam({
    description: 'Tutor-owned teaching listing ID',
    format: 'uuid',
    name: 'listingId',
    type: String,
  });
}

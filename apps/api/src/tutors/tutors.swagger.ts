import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
      ListingPatchRequestDto,
      ListingPostRequestDto,
      ListingResponseDto,
      ListingStatusRequestDto,
    ),
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

function listingIdParam(): MethodDecorator {
  return ApiParam({
    description: 'Tutor-owned teaching listing ID',
    format: 'uuid',
    name: 'listingId',
    type: String,
  });
}

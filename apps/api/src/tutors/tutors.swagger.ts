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
  ApiServiceUnavailableResponse,
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
  GradeLevelCatalogItemDto,
  GradeLevelCatalogResponseDto,
  PublicTeachingListingDto,
  PublicTutorDetailResponseDto,
  PublicTutorProfileDto,
  SubjectCatalogItemDto,
  SubjectCatalogResponseDto,
  TutorSearchQueryDto,
  TutorSearchResultDto,
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

export function PublicTutorsControllerDoc(): ClassDecorator {
  return applyDecorators(
    ApiTags('tutors'),
    ApiExtraModels(
      ApiErrorResponseDto,
      PublicTeachingListingDto,
      PublicTutorDetailResponseDto,
      PublicTutorProfileDto,
      TutorSearchQueryDto,
      TutorSearchResultDto,
    ),
  );
}

export function CatalogControllerDoc(): ClassDecorator {
  return applyDecorators(
    ApiTags('catalog'),
    ApiExtraModels(
      ApiErrorResponseDto,
      GradeLevelCatalogItemDto,
      GradeLevelCatalogResponseDto,
      SubjectCatalogItemDto,
      SubjectCatalogResponseDto,
    ),
  );
}

export function SearchPublicTutorsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      description:
        'Returns one item per published listing owned by a verified, active Tutor. All supplied filters are ANDed.',
      summary: 'Search published verified tutors',
    }),
    ApiQuery({
      description: 'Case-insensitive exact active Subject name',
      example: 'Mathematics',
      name: 'subject',
      required: false,
      type: String,
    }),
    ApiQuery({
      description: 'Exact active GradeLevel name',
      example: 'Grade 10',
      name: 'grade',
      required: false,
      type: String,
    }),
    ApiQuery({
      description: 'Inclusive maximum hourly price in THB',
      example: 500,
      name: 'maxPrice',
      required: false,
      type: Number,
    }),
    ApiQuery({
      description: 'Inclusive minimum rating from 1 to 5; null ratings do not match',
      example: 4,
      name: 'minimumRating',
      required: false,
      type: Number,
    }),
    ApiOkResponse({
      description: 'Matching public listings, or an empty array when there are no matches',
      type: [TutorSearchResultDto],
    }),
    ApiBadRequestResponse({
      description: 'A numeric filter is invalid or subject/grade is not an active catalog value',
      type: ApiErrorResponseDto,
    }),
  );
}

export function GetPublicTutorDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      description:
        "Returns a verified Tutor and only that Tutor's published, non-deleted listings.",
      summary: 'Get public Tutor detail',
    }),
    ApiParam({
      description: 'Tutor User ID',
      example: '20000000-0000-4000-8000-000000000001',
      format: 'uuid',
      name: 'tutorId',
      type: String,
    }),
    ApiOkResponse({ description: 'Public Tutor detail', type: PublicTutorDetailResponseDto }),
    ApiBadRequestResponse({
      description: 'The Tutor ID is not a valid UUID',
      type: ApiErrorResponseDto,
    }),
    ApiNotFoundResponse({
      description: 'Tutor is not publicly available',
      type: ApiErrorResponseDto,
    }),
  );
}

export function GetSubjectCatalogDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get active Subject catalog' }),
    ApiOkResponse({
      description: 'Active Subjects ordered deterministically',
      type: SubjectCatalogResponseDto,
    }),
    ApiServiceUnavailableResponse({
      description: 'Subject catalog is temporarily unavailable',
      type: ApiErrorResponseDto,
    }),
  );
}

export function GetGradeLevelCatalogDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get active GradeLevel catalog' }),
    ApiOkResponse({
      description: 'Active GradeLevels ordered by sortOrder ascending',
      type: GradeLevelCatalogResponseDto,
    }),
    ApiServiceUnavailableResponse({
      description: 'GradeLevel catalog is temporarily unavailable',
      type: ApiErrorResponseDto,
    }),
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

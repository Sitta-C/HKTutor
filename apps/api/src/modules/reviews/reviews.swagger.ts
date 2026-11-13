import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';

export class ReviewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 5, maximum: 5, minimum: 1 }) clarity!: number;
  @ApiProperty({ example: 4, maximum: 5, minimum: 1 }) punctuality!: number;
  @ApiProperty({ example: 5, maximum: 5, minimum: 1 }) preparation!: number;
  @ApiProperty({
    description:
      'Mean of clarity, punctuality and preparation for this one review, rounded half up to 2 decimals.',
    example: 4.67,
  })
  overallRating!: number;
  @ApiProperty({ example: 'Clear examples' }) feedback!: string;
  @ApiProperty({ example: '2026-11-10T11:00:00.000Z', format: 'date-time' }) createdAt!: string;
}

export class CreateReviewResponseDto {
  @ApiProperty({ type: ReviewDto }) review!: ReviewDto;
}

export class GetReviewResponseDto {
  @ApiProperty({ nullable: true, type: ReviewDto }) review!: ReviewDto | null;
}

export class ReviewAuthorDto {
  @ApiProperty({
    description: 'The reviewing student, reduced to a public nickname.',
    example: 'Nan',
  })
  displayName!: string;
}

export class PublicReviewDto extends ReviewDto {
  @ApiProperty({ type: ReviewAuthorDto }) author!: ReviewAuthorDto;
}

export class TutorReviewsResponseDto {
  @ApiProperty({ isArray: true, type: PublicReviewDto }) items!: PublicReviewDto[];
  @ApiProperty({
    description: 'Pass back as ?cursor= to fetch the next page; null on the last page.',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;
}

/** One class-level tag per controller: method-level tags would add a duplicate, auto-named group. */
export function ReviewsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('reviews'));
}

export function CreateReviewDoc(): MethodDecorator {
  return applyDecorators(
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOperation({
      summary: 'Submit a review for one completed booking',
      description:
        'Student owner with current privacy consent only. The booking must be COMPLETED (either ' +
        'attendance outcome); one immutable review per booking, no edit or delete. Updates the tutor ' +
        'rating aggregate in the same transaction.',
    }),
    ApiCreatedResponse({ type: CreateReviewResponseDto }),
    ApiBadRequestResponse({
      description: 'Invalid booking UUID, or a rating/feedback field fails validation',
    }),
    ApiUnauthorizedResponse({ description: 'Authentication required' }),
    ApiForbiddenResponse({
      description:
        'Wrong role, the booking belongs to another student, or consent is missing/outdated',
    }),
    ApiNotFoundResponse({ description: 'Booking not found' }),
    ApiConflictResponse({
      description: 'The booking is not completed yet, or already has a review',
    }),
  );
}

export function GetReviewDoc(): MethodDecorator {
  return applyDecorators(
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOperation({
      summary: "Read the authenticated student's own review for one booking",
      description:
        'Student owner only. Reads the canonical saved review, or null if none was submitted yet; ' +
        'this never writes and never fabricates a review. Eligibility to submit one comes from the ' +
        "booking's own detail, not from this endpoint, so a non-completed booking also answers null.",
    }),
    ApiOkResponse({ type: GetReviewResponseDto }),
    ApiBadRequestResponse({ description: 'Invalid booking UUID' }),
    ApiUnauthorizedResponse({ description: 'Authentication required' }),
    ApiForbiddenResponse({ description: 'Wrong role, or the booking belongs to another student' }),
    ApiNotFoundResponse({ description: 'Booking not found' }),
  );
}

export function GetTutorReviewsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: "List a verified tutor's reviews",
      description:
        'Public, newest first (createdAt desc, id desc), cursor-paginated. Only returns reviews for ' +
        'an existing, verified, active, non-deleted tutor; the author is reduced to a display name. ' +
        'An empty tutor review list answers items: [] rather than 404.',
    }),
    ApiOkResponse({ type: TutorReviewsResponseDto }),
    ApiBadRequestResponse({
      description:
        'Invalid tutor UUID, an out-of-range limit, or a cursor that is malformed or was minted for a different tutor',
    }),
    ApiNotFoundResponse({
      description: 'Tutor not found, unverified, inactive, deleted or hidden',
    }),
  );
}

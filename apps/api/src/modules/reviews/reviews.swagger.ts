import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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

export function CreateReviewDoc(): MethodDecorator {
  return applyDecorators(
    ApiTags('Reviews'),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOperation({
      summary: 'Submit a review for one completed booking',
      description:
        'Student owner only. The booking must be COMPLETED (either attendance outcome); one immutable ' +
        'review per booking, no edit or delete. Updates the tutor rating aggregate in the same transaction.',
    }),
    ApiCreatedResponse({ type: CreateReviewResponseDto }),
    ApiBadRequestResponse({
      description: 'Invalid booking UUID, or a rating/feedback field fails validation',
    }),
    ApiUnauthorizedResponse({ description: 'Authentication required' }),
    ApiForbiddenResponse({ description: 'Wrong role, or the booking belongs to another student' }),
    ApiNotFoundResponse({ description: 'Booking not found' }),
    ApiConflictResponse({
      description: 'The booking is not completed yet, or already has a review',
    }),
  );
}

import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const REVIEW_FEEDBACK_MAX_LENGTH = 1000;

// Counts Unicode code points, as PostgreSQL's CHAR_LENGTH does in Review_feedback_check.
// @MaxLength counts some emoji differently, so a text could pass here and fail in the database.
const REVIEW_FEEDBACK_LENGTH_PATTERN = new RegExp(
  `^[\\s\\S]{1,${REVIEW_FEEDBACK_MAX_LENGTH}}$`,
  'u',
);

export class CreateReviewDto {
  @ApiProperty({ example: 5, maximum: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(5)
  clarity!: number;

  @ApiProperty({ example: 4, maximum: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(5)
  punctuality!: number;

  @ApiProperty({ example: 5, maximum: 5, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(5)
  preparation!: number;

  @ApiProperty({
    description: 'Trimmed before validation. 1-1000 Unicode code points of plain text.',
    example: 'Clear examples',
    maxLength: REVIEW_FEEDBACK_MAX_LENGTH,
    minLength: 1,
  })
  @Transform(trimString)
  @IsString()
  @Matches(REVIEW_FEEDBACK_LENGTH_PATTERN, {
    message: `feedback must be 1-${REVIEW_FEEDBACK_MAX_LENGTH} characters once trimmed`,
  })
  feedback!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, IsInt, IsDefined, IsEnum, IsPositive, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';

//Profile
export type TutorVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export class TutorProfileResponseDto {

  @ApiProperty({ example: '<uuid>' })
  userId!: string;

  @ApiProperty({ example: 'Anan' })
  displayName!: string;

  @ApiProperty({ example: '...' })
  bio!: string;

  @IsInt()
  @ApiProperty({ example: 3 })
  experienceYears!: number;

  @ApiProperty({ example: 'VERIFIED' })
  verificationStatus!: TutorVerificationStatus;

  @IsNumber({ maxDecimalPlaces: 1 })
  @ApiProperty({ example: 4.8 })
  ratingAverage!: number | null;

  @IsInt()
  @ApiProperty({ example: 10 })
  reviewCount!: number;
}

export class TutorProfileUpdateQueryDto {

  @IsString()
  @IsDefined({ message: 'Invalid displayName'})
  displayName!: string;

  @IsString()
  @IsOptional()
  bio?: string;

  @IsOptional()
  @Transform(toNumberWhenPresent)
  @Min(0, { message: 'Negative experience' })
  experienceYears?: number;
}

//Listing
export type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export class ListingQueryDto {

  @IsOptional()
  publicationStatus?: PublicationStatus;
}

export class ListingResponseDto {

  @ApiProperty({ example: '<uuid>' })
  listingId!: string;

  @ApiProperty({ example: `{id: <uuid>, code: <code>, name: math, active: true, createdAt: ${new Date("2026-08-17")}, updatedAt: ${new Date("2026-08-17")}}` })
  subject!: {
    id: string,
    code: string,
    name: string,
    active: boolean,
    createdAt: Date,
    updatedAt: Date,
  };

  @ApiProperty({ example: `{id: <uuid>, code: <code>, name: <name>, active: true, createdAt: ${new Date("2026-08-17")}, updatedAt: ${new Date("2026-08-17")}}` })
  gradeLevel!: {
    id: string,
    code: string,
    name: string,
    active: boolean,
    createdAt: Date,
    updatedAt: Date,
  };

  @IsNumber({ maxDecimalPlaces: 2 })
  @ApiProperty({ example: 199.00 })
  pricePerHour!: number;

  @ApiProperty({ example: '...' })
  description!: string;

  @ApiProperty({ example: 'DRAFT' })
  publicationStatus!: PublicationStatus;

  @ApiProperty({ example: new Date("2026-08-17") })
  publishedAt?: Date | null;

  @ApiProperty({ example: new Date("2026-08-17") })
  updatedAt!: Date;
}

export class ListingPostRequestDto {

  @IsDefined()
  subjectId!: string;

  @IsDefined()
  gradeLevelId!: string;

  @IsDefined()
  @Transform(toNumberWhenPresent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'pricePerHour must be more than 0'})
  pricePerHour!: number;

  @IsDefined()
  @IsString()
  @Length(20, 1000)
  description!: string;
}

export class ListingPatchRequestDto {

  @IsOptional()
  subjectId?: string;

  @IsOptional()
  gradeLevelId?: string;

  @IsOptional()
  @Transform(toNumberWhenPresent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'pricePerHour must be more than 0'})
  pricePerHour?: number;

  @IsOptional()
  @IsString()
  @Length(20, 1000)
  description?: string;
}

function toNumberWhenPresent({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string' || value.trim() === '') {
    return value;
  }

  return Number(value);
}

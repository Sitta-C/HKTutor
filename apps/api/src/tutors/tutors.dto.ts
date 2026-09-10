import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinDate,
  MinLength,
} from 'class-validator';

import { ListingPublicationStatus } from '@/generated/prisma/client';

import type { TransformFnParams } from 'class-transformer';

const trimString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

//Listing
export class ListingQueryDto {
  @ApiPropertyOptional({ enum: ListingPublicationStatus, enumName: 'ListingPublicationStatus' })
  @IsOptional()
  @IsEnum(ListingPublicationStatus)
  publicationStatus?: ListingPublicationStatus;
}

class CatalogValueResponseDto {
  @ApiProperty({ example: '30000000-0000-4000-8000-000000000001', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'MATH' })
  code!: string;

  @ApiProperty({ example: 'Mathematics' })
  name!: string;

  @ApiProperty({ example: true })
  active!: boolean;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  updatedAt!: Date;
}

export class ListingResponseDto {
  @ApiProperty({ example: '10000000-0000-4000-8000-000000000001', format: 'uuid' })
  listingId!: string;

  @ApiProperty({ type: CatalogValueResponseDto })
  subject!: CatalogValueResponseDto;

  @ApiProperty({ type: CatalogValueResponseDto })
  gradeLevel!: CatalogValueResponseDto;

  @ApiProperty({ example: 450.5, minimum: 0, type: Number })
  pricePerHour!: number;

  @ApiProperty({ example: 'Experienced mathematics tutor.' })
  description!: string;

  @ApiProperty({ enum: ListingPublicationStatus, enumName: 'ListingPublicationStatus' })
  publicationStatus!: ListingPublicationStatus;

  @ApiProperty({ example: null, format: 'date-time', nullable: true, type: String })
  publishedAt!: Date | null;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  updatedAt!: Date;
}

export class ListingPostRequestDto {
  @ApiProperty({ example: '30000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ example: '40000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsUUID()
  gradeLevelId!: string;

  @ApiProperty({ example: 450.5, exclusiveMinimum: true, minimum: 0, type: Number })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'pricePerHour must be more than 0' })
  pricePerHour!: number;

  @ApiProperty({ example: 'Experienced mathematics tutor.', maxLength: 1000, minLength: 20 })
  @Transform(trimString)
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  description!: string;
}

export class ListingPatchRequestDto {
  @ApiPropertyOptional({ example: '30000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ example: '40000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  gradeLevelId?: string;

  @ApiPropertyOptional({ example: 450.5, exclusiveMinimum: true, minimum: 0, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'pricePerHour must be more than 0' })
  pricePerHour?: number;

  @ApiPropertyOptional({
    example: 'Experienced mathematics tutor.',
    maxLength: 1000,
    minLength: 20,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  description?: string;
}

//Availability
export const AvailabilityState = {
  OPEN: "OPEN",
  RESERVED: "RESERVED",
} as const

export type AvailabilityState = (typeof AvailabilityState)[keyof typeof AvailabilityState];

export class AvailabilityQueryDto {
  @IsOptional()
  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  from?: Date;

  @IsOptional()
  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  to?: Date;
}

export class AvailabilityPrivateResponseDto {
  @ApiProperty({ example: '30000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  startAtUtc!: Date;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  endAtUtc!: Date;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ enum: AvailabilityState, enumName: 'AvailabilityState' })
  @IsEnum(AvailabilityState)
  state!: AvailabilityState;
}

export class AvailabilityPostRequestDto {
  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  @MinDate(() => new Date(), {
    message: 'The date cannot be in the past.',
  })
  startAtUtc!: Date;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  @MinDate(() => new Date(), {
    message: 'The date cannot be in the past.',
  })
  endAtUtc!: Date;
}

export class AvailabilityPostResponseDto {
  @ApiProperty({ example: '30000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ example: '30000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsUUID()
  tutorProfileId!: string;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  startAtUtc!: Date;

  @ApiProperty({ example: '2026-08-17T00:00:00.000Z', format: 'date-time' })
  endAtUtc!: Date;
}

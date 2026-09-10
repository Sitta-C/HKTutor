import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

import type { TransformFnParams } from 'class-transformer';

//Listing
export type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export class ListingQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  publicationStatus?: PublicationStatus;
}

export class ListingResponseDto {
  @ApiProperty({ example: '<uuid>' })
  listingId!: string;

  @ApiProperty({
    example: `{id: <uuid>, code: <code>, name: math, active: true, createdAt: ${new Date('2026-08-17').toISOString()}, updatedAt: ${new Date('2026-08-17').toISOString()}}`,
  })
  subject!: {
    id: string;
    code: string;
    name: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  @ApiProperty({
    example: `{id: <uuid>, code: <code>, name: <name>, active: true, createdAt: ${new Date('2026-08-17').toISOString()}, updatedAt: ${new Date('2026-08-17').toISOString()}}`,
  })
  gradeLevel!: {
    id: string;
    code: string;
    name: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  @IsNumber({ maxDecimalPlaces: 2 })
  @ApiProperty({ example: 199.0 })
  pricePerHour!: number;

  @ApiProperty({ example: '...' })
  description!: string;

  @ApiProperty({ example: 'DRAFT' })
  publicationStatus!: PublicationStatus;

  @ApiProperty({ example: new Date('2026-08-17') })
  publishedAt?: Date | null;

  @ApiProperty({ example: new Date('2026-08-17') })
  createdAt!: Date;

  @ApiProperty({ example: new Date('2026-08-17') })
  updatedAt!: Date;
}

export class ListingStatusRequestDto {
  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsDefined()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  publicationStatus!: Extract<PublicationStatus, 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'>;
}

export class ListingPostRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsDefined()
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsDefined()
  @IsUUID()
  gradeLevelId!: string;

  @IsDefined()
  @Transform(toNumberWhenPresent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'pricePerHour must be more than 0' })
  pricePerHour!: number;

  @IsDefined()
  @Transform(trimStringWhenPresent)
  @IsString()
  @Length(20, 1000)
  description!: string;
}

export class ListingPatchRequestDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  gradeLevelId?: string;

  @IsOptional()
  @Transform(toNumberWhenPresent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'pricePerHour must be more than 0' })
  pricePerHour?: number;

  @IsOptional()
  @Transform(trimStringWhenPresent)
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

function trimStringWhenPresent({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
} from 'class-validator';

import type { TransformFnParams } from 'class-transformer';

//Listing
export type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export class ListingQueryDto {
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
  @IsPositive({ message: 'pricePerHour must be more than 0' })
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
  @IsPositive({ message: 'pricePerHour must be more than 0' })
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

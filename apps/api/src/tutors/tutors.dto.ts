import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min, IsInt } from 'class-validator';

import type { TransformFnParams } from 'class-transformer';

//Tutor search
export class SearchTutorsQueryDto {
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Transform(toNumberWhenPresent)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  subject?: string;
}

export class TutorResponseDto {
  @ApiProperty({ example: 'Anan' })
  displayName!: string;

  @ApiProperty({ example: 'Grade 10' })
  grade!: string;

  @ApiProperty({ example: 'listing-1' })
  id!: string;

  @ApiProperty({ example: 500 })
  pricePerHour!: number;

  @ApiProperty({ example: 4.8, nullable: true })
  rating!: number | null;

  @ApiProperty({ example: 'Mathematics' })
  subject!: string;
}

//Tutor profile

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

function toNumberWhenPresent({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string' || value.trim() === '') {
    return value;
  }

  return Number(value);
}

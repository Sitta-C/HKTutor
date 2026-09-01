import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

import type { TransformFnParams } from 'class-transformer';

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

function toNumberWhenPresent({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string' || value.trim() === '') {
    return value;
  }

  return Number(value);
}

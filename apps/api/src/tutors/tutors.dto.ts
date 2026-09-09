import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, IsInt, IsDefined } from 'class-validator';
import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';

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

function toNumberWhenPresent({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string' || value.trim() === '') {
    return value;
  }

  return Number(value);
}

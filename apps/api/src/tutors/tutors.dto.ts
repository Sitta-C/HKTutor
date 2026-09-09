import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, IsInt } from 'class-validator';

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

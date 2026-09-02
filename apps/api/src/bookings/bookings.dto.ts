import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  @IsUUID()
  @IsString()
  slotId!: string;

  @ApiProperty({
    example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  @IsString()
  listingId?: string;

  @ApiProperty({
    example: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  @IsString()
  studentUserId?: string;
}

export class BookingResponseDto {
  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  id!: string;

  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  slotId!: string;

  @ApiProperty({ example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d' })
  listingId!: string;

  @ApiProperty({ example: '6bb01222-1fce-4bc3-a69d-3d90db2fdf57' })
  studentUserId!: string;

  @ApiProperty({ example: '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857' })
  tutorProfileId!: string;

  @ApiProperty({ example: 'pending' })
  status!: string;

  @ApiProperty({ example: 500 })
  subtotalAmount!: number;

  @ApiProperty({ example: 0 })
  discountAmount!: number;

  @ApiProperty({ example: 500 })
  netAmount!: number;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

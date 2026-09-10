import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  @IsUUID()
  @IsString()
  slotId!: string;

  @ApiProperty({ example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d' })
  @IsUUID()
  @IsString()
  listingId!: string;
}

export class BookingResponseDto {
  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  id!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d' })
  listingId!: string;

  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  slotId!: string;

  @ApiProperty({ example: '450.00' })
  subtotalAmount!: string;

  @ApiProperty({ example: '0.00' })
  discountAmount!: string;

  @ApiProperty({ example: '450.00' })
  netAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;

  @ApiProperty({ example: '2026-09-10T09:04:31.001Z' })
  createdAt!: string;
}

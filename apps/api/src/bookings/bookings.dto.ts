import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';

import { BookingStatus } from '@/generated/prisma/enums';

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

export class GetBookingQuoteQueryDto {
  @ApiProperty({ example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d' })
  @IsUUID()
  @IsString()
  listingId!: string;

  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  @IsUUID()
  @IsString()
  slotId!: string;
}

export class BookingQuoteTutorDto {
  @ApiProperty({ example: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc' })
  tutorId!: string;

  @ApiProperty({ example: 'Anan Suksawat' })
  displayName!: string;
}

export class BookingQuoteListingDto {
  @ApiProperty({ example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d' })
  id!: string;

  @ApiProperty({ example: 'd1136608-6be5-463f-be15-2b54a376b8d4' })
  subjectId!: string;

  @ApiProperty({ example: 'Mathematics' })
  subjectName!: string;

  @ApiProperty({ example: '095a49be-500a-4e17-85c8-2c56dd8d8c9f' })
  gradeLevelId!: string;

  @ApiProperty({ example: 'Grade 10' })
  gradeLevelName!: string;

  @ApiProperty({ example: '450.00' })
  pricePerHour!: string;

  @ApiProperty({ example: 'One-on-one algebra and calculus tutoring.' })
  description!: string;
}

export class BookingQuoteSlotDto {
  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  id!: string;

  @ApiProperty({ example: '2026-09-15T10:04:06.784Z' })
  startAtUtc!: string;

  @ApiProperty({ example: '2026-09-15T11:04:06.784Z' })
  endAtUtc!: string;
}

export class BookingQuoteResponseDto {
  @ApiProperty({ type: BookingQuoteTutorDto })
  tutor!: BookingQuoteTutorDto;

  @ApiProperty({ type: BookingQuoteListingDto })
  listing!: BookingQuoteListingDto;

  @ApiProperty({ type: BookingQuoteSlotDto })
  slot!: BookingQuoteSlotDto;

  @ApiProperty({ example: '450.00' })
  subtotalAmount!: string;

  @ApiProperty({ example: '0.00' })
  discountAmount!: string;

  @ApiProperty({ example: '450.00' })
  netAmount!: string;

  @ApiProperty({ example: 'THB' })
  currency!: string;
}

export class GetMyBookingsQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class BookingViewDto {
  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  id!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ type: BookingQuoteTutorDto })
  tutor!: BookingQuoteTutorDto;

  @ApiProperty({ type: BookingQuoteListingDto })
  listing!: BookingQuoteListingDto;

  @ApiProperty({ type: BookingQuoteSlotDto })
  slot!: BookingQuoteSlotDto;

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

export class MyBookingsResponseDto {
  @ApiProperty({ type: [BookingViewDto] })
  items!: BookingViewDto[];

  @ApiProperty({ example: 1 })
  total!: number;
}

export class BookingDetailResponseDto extends BookingViewDto {
  @ApiProperty({ example: '2026-09-10T09:04:31.001Z' })
  updatedAt!: string;
}

export class GetTutorBookingsQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class TutorBookingStudentDto {
  @ApiProperty({ example: 'Nan', type: String })
  nickname!: string;
}

export class TutorBookingViewDto {
  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  id!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiProperty({ type: BookingQuoteListingDto })
  listing!: BookingQuoteListingDto;

  @ApiProperty({ type: BookingQuoteSlotDto })
  slot!: BookingQuoteSlotDto;

  @ApiProperty({ type: TutorBookingStudentDto })
  student!: TutorBookingStudentDto;

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

export class TutorBookingsResponseDto {
  @ApiProperty({ type: [TutorBookingViewDto] })
  items!: TutorBookingViewDto[];

  @ApiProperty({ example: 1 })
  total!: number;
}

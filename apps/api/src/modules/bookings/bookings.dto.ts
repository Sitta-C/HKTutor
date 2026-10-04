import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { BookingStatus } from '@generated/prisma/enums';

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

  @ApiPropertyOptional({ enum: ['VERIFIED'], example: 'VERIFIED' })
  verificationStatus?: 'VERIFIED';
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

export const DEFAULT_BOOKINGS_PAGE = 1;
export const DEFAULT_BOOKINGS_PAGE_SIZE = 20;
export const MAX_BOOKINGS_PAGE_SIZE = 100;

export class BookingsPaginationQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_BOOKINGS_PAGE, example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: DEFAULT_BOOKINGS_PAGE_SIZE,
    example: DEFAULT_BOOKINGS_PAGE_SIZE,
    maximum: MAX_BOOKINGS_PAGE_SIZE,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_BOOKINGS_PAGE_SIZE)
  pageSize?: number;
}

export class GetMyBookingsQueryDto extends BookingsPaginationQueryDto {
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

export class GetTutorBookingsQueryDto extends BookingsPaginationQueryDto {
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
  @ApiProperty({ example: 'Nan', nullable: true, type: String })
  nickname!: string | null;
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

export const MAX_TUTOR_ACTION_TEXT_LENGTH = 500;
/** A blank string would be stored as an empty cancellation reason, which the database rejects. */
const NOT_BLANK_PATTERN = /\S/;

/**
 * Availability is derived from the bookings holding a slot, so these values report whether the
 * acted-on booking still reserves its slot. `AVAILABLE` matches the S2-T01 card; the tutor
 * availability API reports the same free state as `OPEN`.
 */
export const BookingSlotStatus = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
} as const;
export type BookingSlotStatus = (typeof BookingSlotStatus)[keyof typeof BookingSlotStatus];

export class ConfirmBookingDto {
  @ApiPropertyOptional({
    description:
      'Optional note from the tutor. Accepted by the contract but not persisted: the Booking model has no note column yet.',
    example: 'See you in class.',
    maxLength: MAX_TUTOR_ACTION_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TUTOR_ACTION_TEXT_LENGTH)
  @Matches(NOT_BLANK_PATTERN, { message: 'note must not be blank' })
  note?: string;
}

export class RejectBookingDto {
  @ApiPropertyOptional({
    description: 'Why the tutor rejected the booking. A default reason is stored when omitted.',
    example: 'I am no longer available at that time.',
    maxLength: MAX_TUTOR_ACTION_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TUTOR_ACTION_TEXT_LENGTH)
  @Matches(NOT_BLANK_PATTERN, { message: 'reason must not be blank' })
  reason?: string;
}

export class TutorBookingActionResponseDto {
  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  bookingId!: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status!: BookingStatus;

  @ApiProperty({
    description: 'Whether the booking still reserves its availability slot after the transition.',
    enum: Object.values(BookingSlotStatus),
    example: BookingSlotStatus.RESERVED,
  })
  slotStatus!: BookingSlotStatus;

  @ApiProperty({
    description: 'Set when the booking was canceled; null for a confirmation.',
    example: null,
    nullable: true,
    type: String,
  })
  canceledAt!: string | null;
}

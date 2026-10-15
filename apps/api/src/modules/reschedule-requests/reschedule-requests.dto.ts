import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { BookingStatus, RescheduleRequestStatus } from '@generated/prisma/enums';

export const MAX_RESCHEDULE_TEXT_LENGTH = 500;
const NOT_BLANK_PATTERN = /\S/;

export const RescheduleAction = {
  CREATE: 'CREATE',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  WITHDRAW: 'WITHDRAW',
} as const;
export type RescheduleAction = (typeof RescheduleAction)[keyof typeof RescheduleAction];

export class CreateRescheduleRequestDto {
  @ApiProperty({
    description: 'The target availability slot to move the booking to.',
    example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
  })
  @IsUUID()
  @IsString()
  targetSlotId!: string;

  @ApiPropertyOptional({
    description:
      'Optional explanation for the reschedule. Maximum 500 characters, non-blank when provided.',
    example: 'Schedule conflict with university exam.',
    maxLength: MAX_RESCHEDULE_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESCHEDULE_TEXT_LENGTH)
  @Matches(NOT_BLANK_PATTERN, { message: 'reason must not be blank' })
  reason?: string;
}

export class RejectRescheduleRequestDto {
  @ApiPropertyOptional({
    description:
      'Optional reason for rejecting the reschedule. Maximum 500 characters, non-blank when provided.',
    example: 'I cannot accommodate the requested new time.',
    maxLength: MAX_RESCHEDULE_TEXT_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RESCHEDULE_TEXT_LENGTH)
  @Matches(NOT_BLANK_PATTERN, { message: 'reason must not be blank' })
  reason?: string;
}

export class CreateRescheduleRequestResponseDto {
  @ApiProperty({ example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020' })
  requestId!: string;

  @ApiProperty({ enum: RescheduleRequestStatus, example: RescheduleRequestStatus.PENDING })
  status!: RescheduleRequestStatus;

  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  bookingId!: string;

  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  targetSlotId!: string;
}

export class RescheduleTargetSlotDto {
  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  id!: string;

  @ApiProperty({ example: '2026-10-25T10:00:00.000Z' })
  startAtUtc!: string;

  @ApiProperty({ example: '2026-10-25T11:00:00.000Z' })
  endAtUtc!: string;

  @ApiProperty({ example: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc' })
  tutorProfileId!: string;
}

export class RescheduleRequestViewDto {
  @ApiProperty({ example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020' })
  id!: string;

  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  bookingId!: string;

  @ApiProperty({ example: '70e1232d-3c06-4d5d-b3d2-6026df5ff315' })
  requestedById!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  fromSlotId!: string;

  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  requestedSlotId!: string;

  @ApiProperty({ example: 'Schedule conflict with university exam.' })
  reason!: string;

  @ApiProperty({ enum: RescheduleRequestStatus, example: RescheduleRequestStatus.PENDING })
  status!: RescheduleRequestStatus;

  @ApiProperty({ example: '2026-10-15T12:00:00.000Z' })
  requestedAt!: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  reviewedById!: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  decidedAt!: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  withdrawnAt!: string | null;
}

export class CurrentRescheduleRequestResponseDto {
  @ApiProperty({ nullable: true, type: RescheduleRequestViewDto })
  request!: RescheduleRequestViewDto | null;

  @ApiProperty({ nullable: true, type: RescheduleTargetSlotDto })
  targetSlot!: RescheduleTargetSlotDto | null;

  @ApiProperty({
    description:
      'Actions currently available to the caller. APPROVE requires a confirmed booking at least ' +
      '24 hours before class (including exactly 24 hours) and a valid available target. ' +
      'REJECT and WITHDRAW remain available to the counterparty and requester respectively ' +
      'while the request is pending, even when approval is no longer possible.',
    enum: Object.values(RescheduleAction),
    example: [RescheduleAction.APPROVE, RescheduleAction.REJECT],
    isArray: true,
  })
  allowedActions!: RescheduleAction[];
}

export class ApprovedRescheduleBookingDto {
  @ApiProperty({ example: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae' })
  id!: string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status!: BookingStatus;

  @ApiProperty({ example: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' })
  slotId!: string;

  @ApiProperty({ example: '70e1232d-3c06-4d5d-b3d2-6026df5ff315' })
  studentUserId!: string;

  @ApiProperty({ example: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc' })
  tutorProfileId!: string;

  @ApiProperty({ example: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d' })
  listingId!: string;

  @ApiProperty({ example: '450.00' })
  subtotalAmount!: string;

  @ApiProperty({ example: '450.00' })
  netAmount!: string;

  @ApiProperty({ example: '2026-10-15T12:30:00.000Z' })
  updatedAt!: string;
}

export class ApproveRescheduleResponseDto {
  @ApiProperty({ example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020' })
  requestId!: string;

  @ApiProperty({ enum: RescheduleRequestStatus, example: RescheduleRequestStatus.APPROVED })
  status!: RescheduleRequestStatus;

  @ApiProperty({ type: ApprovedRescheduleBookingDto })
  booking!: ApprovedRescheduleBookingDto;

  @ApiProperty({ type: RescheduleTargetSlotDto })
  newSlot!: RescheduleTargetSlotDto;
}

export class RejectRescheduleResponseDto {
  @ApiProperty({ example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020' })
  requestId!: string;

  @ApiProperty({ enum: RescheduleRequestStatus, example: RescheduleRequestStatus.REJECTED })
  status!: RescheduleRequestStatus;

  @ApiProperty({ example: '2026-10-15T12:30:00.000Z' })
  reviewedAt!: string;
}

export class WithdrawRescheduleResponseDto {
  @ApiProperty({ example: '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020' })
  requestId!: string;

  @ApiProperty({ enum: RescheduleRequestStatus, example: RescheduleRequestStatus.WITHDRAWN })
  status!: RescheduleRequestStatus;

  @ApiProperty({ example: '2026-10-15T12:30:00.000Z' })
  withdrawnAt!: string;
}

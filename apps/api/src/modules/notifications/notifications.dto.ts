import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const DEFAULT_NOTIFICATIONS_LIMIT = 20;
export const MAX_NOTIFICATIONS_LIMIT = 50;
export const MAX_NOTIFICATION_CURSOR_LENGTH = 512;

export class GetNotificationsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque nextCursor from a previous page', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_NOTIFICATION_CURSOR_LENGTH)
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(MAX_NOTIFICATIONS_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ default: false, type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unreadOnly?: boolean;
}

/** Binds otherwise-unused inputs so the global whitelist rejects caller-supplied authority. */
export class NotificationEmptyInputDto {}

export class NotificationItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'BOOKING_CONFIRMED' })
  eventType!: string;

  @ApiProperty({ example: 'Booking confirmed' })
  title!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  bookingId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class NotificationsResponseDto {
  @ApiProperty({ type: [NotificationItemDto] })
  items!: NotificationItemDto[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({
    description: 'All unread notifications in the caller inbox, across pages',
    minimum: 0,
  })
  unreadCount!: number;
}

export class NotificationReadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time', description: 'First read time; preserved on retries' })
  readAt!: string;
}

export class NotificationsReadAllResponseDto {
  @ApiProperty({ minimum: 0 })
  updatedCount!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Latest time written by this call; null when no unread row was updated',
  })
  readAt!: string | null;
}

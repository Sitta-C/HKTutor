import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const MAX_COUPON_CURSOR_LENGTH = 512;
export const DEFAULT_COUPON_LIMIT = 20;
/** Normalized (trimmed, ASCII-uppercased) code; shared by validation and Swagger. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
/** PostgreSQL INTEGER upper bound for Coupon.maxUses. */
export const MAX_COUPON_USES = 2147483647;

export class CreateCouponDto {
  @ApiProperty({
    description:
      'Trimmed, then ASCII a-z uppercased before validation: 3–32 of A-Z, 0-9, underscore or ' +
      'hyphen. Unique case-insensitively (CITEXT), so welcome10 collides with WELCOME10.',
    example: 'WELCOME10',
    pattern: COUPON_CODE_PATTERN.source,
    minLength: 3,
    maxLength: 32,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase())
      : value,
  )
  @IsString()
  @Matches(COUPON_CODE_PATTERN)
  code!: string;

  @ApiProperty({
    description: 'JSON integer percentage discount, 1–100 inclusive. No fixed-amount coupons.',
    example: 10,
    minimum: 1,
    maximum: 100,
    type: 'integer',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  percent!: number;

  @ApiProperty({
    description:
      'Full UTC instant ending in Z, at most millisecond precision, strictly in the future. ' +
      'Exclusive: the coupon is usable only while now < expiresAt. Convert a Bangkok date and ' +
      'time to UTC first (2026-11-30 23:59:59 Bangkok is the example). Date-only values and ' +
      'offsets are rejected; the server never guesses an end-of-day time.',
    example: '2026-11-30T16:59:59.000Z',
    format: 'date-time',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  expiresAt!: string;

  @ApiProperty({
    description: 'JSON integer total uses, at least 1.',
    example: 100,
    minimum: 1,
    maximum: MAX_COUPON_USES,
    type: 'integer',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_COUPON_USES)
  maxUses!: number;

  @ApiPropertyOptional({
    default: true,
    description: 'JSON boolean; omitted means true and an explicit false is kept.',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class SetCouponActivationDto {
  @ApiProperty({ description: 'Desired activation state. Does not change expiry or capacity.' })
  @IsBoolean()
  active!: boolean;
}

export class IncreaseCouponCapacityDto {
  @ApiProperty({
    description:
      'Desired total usage limit. Only increases are allowed on active, unexpired coupons. Repeating the current total is a no-op; existing uses and reservations remain counted.',
    type: 'integer',
    minimum: 1,
    maximum: MAX_COUPON_USES,
    example: 200,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_COUPON_USES)
  maxUses!: number;
}

export class ListCouponsQueryDto {
  @ApiPropertyOptional({ maxLength: MAX_COUPON_CURSOR_LENGTH })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_COUPON_CURSOR_LENGTH)
  cursor?: string;

  @ApiPropertyOptional({ default: DEFAULT_COUPON_LIMIT, minimum: 1, maximum: 50 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

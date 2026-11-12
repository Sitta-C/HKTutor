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

export class CreateCouponDto {
  @ApiProperty({ example: 'WELCOME10', pattern: '^[A-Z0-9_-]{3,32}$' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase())
      : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,32}$/)
  code!: string;

  @ApiProperty({ example: 10, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  percent!: number;

  @ApiProperty({
    description:
      'Full UTC instant ending in Z, at most millisecond precision, strictly in the future.',
    example: '2026-11-30T16:59:59.000Z',
    format: 'date-time',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
  expiresAt!: string;

  @ApiProperty({ example: 100, minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  maxUses!: number;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class SetCouponActivationDto {
  @ApiProperty({ description: 'Desired activation state. Does not change expiry or capacity.' })
  @IsBoolean()
  active!: boolean;
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

import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import { COUPON_CODE_PATTERN, MAX_COUPON_USES } from '@modules/coupons/coupons.dto';

export class CouponSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({
    example: 'WELCOME10',
    description: 'Code stored when applied, not the live code.',
  })
  code!: string;
  @ApiProperty({ minimum: 1, maximum: 100, example: 10 }) percent!: number;
}

export class CouponDto {
  @ApiProperty({ format: 'uuid', example: '66666666-6666-4666-8666-666666666666' }) id!: string;
  @ApiProperty({
    example: 'WELCOME10',
    description: 'Normalized uppercase code; unique case-insensitively.',
    pattern: COUPON_CODE_PATTERN.source,
  })
  code!: string;
  @ApiProperty({ example: 10, minimum: 1, maximum: 100, type: 'integer' }) percent!: number;
  @ApiProperty({
    format: 'date-time',
    example: '2026-11-30T16:59:59.000Z',
    description: 'Exclusive expiry, UTC ISO 8601: usable only while now < expiresAt.',
  })
  expiresAt!: string;
  @ApiProperty({ example: 100, minimum: 1, maximum: MAX_COUPON_USES, type: 'integer' })
  maxUses!: number;
  @ApiProperty({
    example: true,
    description: 'Stored activation flag, not an eligibility promise.',
  })
  active!: boolean;
  @ApiProperty({
    example: 0,
    type: 'integer',
    description: 'CouponUse rows from verified or zero-net settlements; never refunded.',
  })
  consumedUses!: number;
  @ApiProperty({
    example: 0,
    type: 'integer',
    description: 'RESERVED only, including uncertain payment outcomes.',
  })
  reservedUses!: number;
  @ApiProperty({
    example: 100,
    type: 'integer',
    description: 'maxUses - consumedUses - reservedUses.',
  })
  availableUses!: number;
  @ApiProperty({ format: 'date-time', example: '2026-11-10T11:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', example: '2026-11-10T11:00:00.000Z' }) updatedAt!: string;
}

export class CouponListDto {
  @ApiProperty({ type: [CouponDto] }) items!: CouponDto[];
  @ApiProperty({
    nullable: true,
    type: String,
    example: null,
    description: 'Opaque exclusive cursor for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}

/** The error envelope for a case-insensitive coupon code collision. */
export const COUPON_CODE_EXISTS_EXAMPLE = {
  statusCode: 409,
  error: 'Conflict',
  code: 'COUPON_CODE_EXISTS',
  message: 'A coupon with this code already exists',
} as const;

function couponAuthDocs(): MethodDecorator {
  return applyDecorators(
    ApiTags('Admin coupons'),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiUnauthorizedResponse({
      description: 'Missing, invalid, expired or revoked access session.',
    }),
    ApiForbiddenResponse({
      description: 'ADMIN role required. Privacy consent is not required for administrators.',
    }),
  );
}

export function CreateCouponDoc(): MethodDecorator {
  return applyDecorators(
    couponAuthDocs(),
    ApiOperation({
      summary: 'Create a percentage coupon (ADMIN only)',
      description:
        'US9-1 (S3-T21). Trims the code and uppercases ASCII a-z, then requires 3–32 of ' +
        'A-Z, 0-9, underscore or hyphen; CITEXT uniqueness makes welcome10 collide with ' +
        'WELCOME10. percent (1–100) and maxUses (>= 1) must be JSON integers. expiresAt is a ' +
        'full UTC instant ending in Z and must be strictly future; expiry is exclusive (usable ' +
        'only while now < expiresAt). Convert Bangkok date and time input to UTC before ' +
        'sending; date-only values are rejected rather than guessed as end of day. active ' +
        'defaults to true. The coupon and exactly one actor-bound coupon.create audit event ' +
        '(afterData: percent, maxUses, active) commit or roll back together through the DB02 ' +
        'trigger. The response never includes audit data. There is no edit or delete route; ' +
        'only activation can change afterwards.',
    }),
    ApiCreatedResponse({ type: CouponDto }),
    ApiBadRequestResponse({
      description:
        'VALIDATION_FAILED: invalid, missing or unknown fields, a past or current expiry, ' +
        'date-only or offset expiry, or a non-integer percent/maxUses.',
    }),
    ApiConflictResponse({
      description: 'COUPON_CODE_EXISTS: case-insensitive code collision.',
      schema: { type: 'object', example: COUPON_CODE_EXISTS_EXAMPLE },
    }),
  );
}

export function ListCouponsDoc(): MethodDecorator {
  return applyDecorators(
    couponAuthDocs(),
    ApiOperation({
      summary: 'List coupon metadata and capacity (ADMIN only)',
      description:
        'US9-1 (S3-T21). Newest first by createdAt/id DESC, limit 1–50 (default 20). Opaque ' +
        'exclusive cursor. Includes inactive, expired and exhausted coupons. active is the ' +
        'stored flag; eligibility requires active && now < expiresAt && availableUses > 0. ' +
        'consumedUses counts CouponUse and is never refunded or decremented; reservedUses ' +
        'counts RESERVED claims; availableUses = maxUses - consumedUses - reservedUses. Counts ' +
        'share one database snapshot. No student, redemption, audit or payment-provider ' +
        'details. Private responses are no-store.',
    }),
    ApiOkResponse({ type: CouponListDto }),
    ApiBadRequestResponse({ description: 'VALIDATION_FAILED: invalid/unknown query or cursor.' }),
  );
}

export function SetCouponActivationDoc(): MethodDecorator {
  return applyDecorators(
    couponAuthDocs(),
    ApiOperation({
      summary: 'Set coupon activation (ADMIN only)',
      description:
        'Accepts only { active: boolean }. Serializes writes and atomically records a coupon.active_change audit for actual changes. Repeating the current state is a no-op. Returns current metadata/capacity. Expiry, pricing, consumed uses and payment reservations are unchanged; a reserved QR remains honored. Activation alone does not make an expired/exhausted coupon usable. Requires the activation-audit migration; no admin privacy consent required.',
    }),
    ApiOkResponse({ type: CouponDto }),
    ApiBadRequestResponse({
      description:
        'INVALID_UUID or VALIDATION_FAILED: required JSON boolean active; no extra fields.',
    }),
    ApiNotFoundResponse({ description: 'Coupon not found.' }),
  );
}

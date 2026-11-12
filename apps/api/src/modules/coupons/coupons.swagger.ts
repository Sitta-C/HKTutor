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
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'WELCOME10' }) code!: string;
  @ApiProperty({ example: 10, minimum: 1, maximum: 100 }) percent!: number;
  @ApiProperty({ format: 'date-time', description: 'Exclusive expiry, UTC ISO 8601.' })
  expiresAt!: string;
  @ApiProperty({ example: 100 }) maxUses!: number;
  @ApiProperty({ example: true }) active!: boolean;
  @ApiProperty({ example: 0 }) consumedUses!: number;
  @ApiProperty({ example: 0, description: 'RESERVED only, including uncertain payment outcomes.' })
  reservedUses!: number;
  @ApiProperty({ example: 100, description: 'maxUses - consumedUses - reservedUses.' })
  availableUses!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CouponListDto {
  @ApiProperty({ type: [CouponDto] }) items!: CouponDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

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
        'Trims and uppercases the code. Numeric fields must be JSON integers. UTC expiry must be ' +
        'strictly future. active defaults to true. The coupon and one actor-bound coupon.create ' +
        'audit event commit atomically through the DB02 trigger. Activation can be changed through the dedicated activation route. No pricing edit/delete route.',
    }),
    ApiCreatedResponse({ type: CouponDto }),
    ApiBadRequestResponse({
      description: 'VALIDATION_FAILED: invalid, missing or unknown fields.',
    }),
    ApiConflictResponse({ description: 'COUPON_CODE_EXISTS: case-insensitive code collision.' }),
  );
}

export function ListCouponsDoc(): MethodDecorator {
  return applyDecorators(
    couponAuthDocs(),
    ApiOperation({
      summary: 'List coupon metadata and capacity (ADMIN only)',
      description:
        'Newest first by createdAt/id DESC, limit 1–50 (default 20). Opaque exclusive cursor. ' +
        'Includes inactive, expired and exhausted coupons. active is the stored flag; eligibility ' +
        'requires active && now < expiresAt && availableUses > 0. Counts share one database ' +
        'snapshot. No student, redemption or payment-provider details. Private responses are no-store.',
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

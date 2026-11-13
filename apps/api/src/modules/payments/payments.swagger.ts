import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import { CouponSnapshotDto } from '@modules/coupons/coupons.swagger';

class PaymentAttemptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['CREATING', 'PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED'] })
  status!: string;
  @ApiProperty({ example: '450.00' }) amount!: string;
  @ApiProperty({ example: 'THB' }) currency!: string;
  @ApiProperty({ type: CouponSnapshotDto, nullable: true }) coupon!: CouponSnapshotDto | null;
  @ApiProperty({ type: String, nullable: true }) chargeId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'HTTPS QR image from Omise; present only while pending.',
  })
  qrCodeUrl!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) expiresAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) failureCode!: string | null;
}

export class PaymentResponseDto {
  @ApiProperty({ example: '450.00' }) subtotalAmount!: string;
  @ApiProperty({ example: '45.00' }) discountAmount!: string;
  @ApiProperty({ example: '405.00' }) netAmount!: string;
  @ApiProperty({ example: 'THB' }) currency!: string;
  @ApiProperty({ type: CouponSnapshotDto, nullable: true }) coupon!: CouponSnapshotDto | null;
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ enum: ['UNPAID', 'PAID'] }) paymentStatus!: 'UNPAID' | 'PAID';
  @ApiProperty() paymentPending!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) paidAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
  @ApiProperty({ type: PaymentAttemptDto, nullable: true }) attempt!: PaymentAttemptDto | null;
}

/** One class-level tag per controller: method-level tags would add a duplicate, auto-named group. */
export function PaymentsControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('payments'));
}

export function StudentPaymentDoc(create: boolean): MethodDecorator {
  return applyDecorators(
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOperation({
      summary: create
        ? 'Create or resume a test PromptPay payment'
        : 'Reconcile and read the latest payment',
      description:
        'Student owner only. New payments (including zero-net coupons) require now < slot.startAtUtc. QR expiry is capped at this deadline. Existing attempts remain readable/reconcilable after it; verified success is still recorded. Amount and currency come from the booking. One active attempt per booking. Unknown creation outcomes remain locked until recovered. Reads independently retrieve the Omise charge; they never create a charge. Test mode only. Responses include stored booking amounts and immutable coupon snapshots. Applied coupons are revalidated and reserved atomically before a provider call. Verified success consumes the reservation together with the paid receipt; confirmed failure/expiry releases it. Uncertain outcomes retain capacity. A valid full coupon settles zero net without provider configuration, charge or attempt, with reference coupon:<useId>. Reserved coupons remain honored after expiry. Current privacy consent is required.',
    }),
    ApiOkResponse({ type: PaymentResponseDto }),
    ApiBadRequestResponse({ description: 'Invalid booking UUID or nonempty payment request body' }),
    ApiUnauthorizedResponse({ description: 'Authentication required' }),
    ApiForbiddenResponse({
      description: 'Wrong role, booking owner or missing/outdated privacy consent',
    }),
    ApiNotFoundResponse({ description: 'Booking not found' }),
    ApiConflictResponse({
      description:
        'BOOKING_PAYMENT_DEADLINE_PASSED, BOOKING_NOT_PAYABLE, PAYMENT_STATE_CONFLICT (stale quote or mismatched snapshot), COUPON_EXPIRED, COUPON_INACTIVE, COUPON_EXHAUSTED, COUPON_ALREADY_USED, PAYMENT_AMOUNT_UNSUPPORTED (positive net outside THB 20–150000), or mismatched charge',
    }),
    ApiServiceUnavailableResponse({
      description:
        'Payments not configured or Omise response unavailable/uncertain. Refresh status before retrying.',
    }),
  );
}

export function OmiseWebhookDoc(): MethodDecorator {
  return applyDecorators(
    ApiHeader({
      name: 'Omise-Signature',
      required: true,
      description: 'Hex HMAC-SHA256 signature(s) over timestamp.raw-body',
    }),
    ApiHeader({
      name: 'Omise-Signature-Timestamp',
      required: true,
      description: 'Signature timestamp in Unix seconds',
    }),
    ApiOperation({
      summary: 'Receive signed Omise test charge events',
      description:
        'Requires Omise-Signature and Omise-Signature-Timestamp headers over the raw body. Retrieves the charge independently. Verified success atomically commits the paid booking, successful attempt, consumed reservation and trigger-generated CouponUse/audit. Confirmed failure/expiry releases capacity. Duplicate/out-of-order events cannot downgrade terminal payments or duplicate evidence. Configure this HTTPS URL on the Omise Test Dashboard.',
    }),
    ApiOkResponse({
      description: 'Event processed or unrelated event ignored',
      schema: {
        type: 'object',
        required: ['received'],
        properties: { received: { type: 'boolean', enum: [true] } },
      },
    }),
    ApiUnauthorizedResponse({
      description: 'Missing/invalid signature or timestamp older than five minutes',
    }),
    ApiConflictResponse({ description: 'Invalid test event or mismatched charge' }),
    ApiServiceUnavailableResponse({
      description: 'Cannot verify charge; status reconciliation can recover later',
    }),
  );
}

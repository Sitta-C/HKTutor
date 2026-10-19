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

class PaymentAttemptDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['CREATING', 'PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED'] })
  status!: string;
  @ApiProperty({ example: '450.00' }) amount!: string;
  @ApiProperty({ example: 'THB' }) currency!: string;
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
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ enum: ['UNPAID', 'PAID'] }) paymentStatus!: 'UNPAID' | 'PAID';
  @ApiProperty() paymentPending!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) paidAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) reference!: string | null;
  @ApiProperty({ type: PaymentAttemptDto, nullable: true }) attempt!: PaymentAttemptDto | null;
}

export function StudentPaymentDoc(create: boolean): MethodDecorator {
  return applyDecorators(
    ApiTags('Payments'),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiOperation({
      summary: create
        ? 'Create or resume a test PromptPay payment'
        : 'Reconcile and read the latest payment',
      description:
        'Student owner only. Amount and currency come from the booking. One active attempt per booking. Unknown creation outcomes remain locked until recovered. Reads independently retrieve the Omise charge; they never create a charge. Test mode only.',
    }),
    ApiOkResponse({ type: PaymentResponseDto }),
    ApiBadRequestResponse({ description: 'Invalid booking UUID or nonempty payment request body' }),
    ApiUnauthorizedResponse({ description: 'Authentication required' }),
    ApiForbiddenResponse({ description: 'Wrong role or booking owner' }),
    ApiNotFoundResponse({ description: 'Booking not found' }),
    ApiConflictResponse({
      description:
        'Booking is not payable, amount is outside PromptPay limits, or charge data does not match',
    }),
    ApiServiceUnavailableResponse({
      description:
        'Payments not configured or Omise response unavailable/uncertain. Refresh status before retrying.',
    }),
  );
}

export function OmiseWebhookDoc(): MethodDecorator {
  return applyDecorators(
    ApiTags('Payments'),
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
        'Requires Omise-Signature and Omise-Signature-Timestamp headers over the raw body. Retrieves the charge independently. Duplicate/out-of-order events cannot downgrade terminal payments. Configure this HTTPS URL on the Omise Test Dashboard.',
    }),
    ApiOkResponse({ description: 'Event processed or unrelated event ignored' }),
    ApiUnauthorizedResponse({
      description: 'Missing/invalid signature or timestamp older than five minutes',
    }),
    ApiConflictResponse({ description: 'Invalid test event or mismatched charge' }),
    ApiServiceUnavailableResponse({
      description: 'Cannot verify charge; status reconciliation can recover later',
    }),
  );
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/enums';
import { isRecord, OmiseService } from '@infrastructure/payments/omise.service';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { RequireOwnership } from '@modules/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { PaymentsService } from '@modules/payments/payments.service';
import {
  OmiseWebhookDoc,
  PaymentResponseDto,
  StudentPaymentDoc,
} from '@modules/payments/payments.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

@Controller('bookings/me/:bookingId/payments')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.STUDENT)
@RequireOwnership({
  resource: 'booking',
  idParam: 'bookingId',
  errors: {
    foreignOwner: { code: 'BOOKING_NOT_OWNED', message: 'This booking belongs to another student' },
  },
})
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('promptpay')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @StudentPaymentDoc(true)
  create(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<PaymentResponseDto> {
    if (body !== undefined && (!isRecord(body) || Object.keys(body).length !== 0)) {
      throw new BadRequestException('Payment creation accepts an empty body only');
    }
    return this.payments.create(bookingId, user.id);
  }

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @StudentPaymentDoc(false)
  current(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    return this.payments.getStatus(bookingId, user.id);
  }
}

@Controller('payments/omise')
export class OmiseWebhookController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly omise: OmiseService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @OmiseWebhookDoc()
  async receive(@Req() request: RawBodyRequest<Request>): Promise<{ received: true }> {
    this.omise.verifyWebhook(
      request.rawBody,
      request.get('Omise-Signature-Timestamp'),
      request.get('Omise-Signature'),
    );
    const body: unknown = request.body;
    await this.payments.webhook(body);
    return { received: true };
  }
}

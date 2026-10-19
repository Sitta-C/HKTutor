import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  isRecord,
  OmiseRequestRejected,
  OmiseService,
} from '@infrastructure/payments/omise.service';

import type { PaymentAttempt } from '@generated/prisma/client';
import type { OmiseCharge } from '@infrastructure/payments/omise.service';
import type { PaymentResponseDto } from '@modules/payments/payments.swagger';

const ACTIVE_STATUSES = ['CREATING', 'PENDING'] as const;
const bookingSelect = {
  id: true,
  studentUserId: true,
  status: true,
  paymentStatus: true,
  paymentPending: true,
  netAmount: true,
  currency: true,
  paidAt: true,
  mockReference: true,
  paymentReference: true,
} satisfies Prisma.BookingSelect;

function conflict(): ConflictException {
  return new ConflictException({
    code: 'PAYMENT_STATE_CONFLICT',
    message: 'Refresh the booking and payment status before continuing',
  });
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly omise: OmiseService,
  ) {}

  async create(bookingId: string, studentUserId: string): Promise<PaymentResponseDto> {
    this.omise.assertEnabled();
    const booking = await this.ownedBooking(bookingId, studentUserId);
    if (booking.paymentStatus === 'PAID' || booking.paymentPending) {
      return this.getStatus(bookingId, studentUserId);
    }
    if (booking.status !== 'CONFIRMED') {
      throw conflict();
    }
    const subunits = booking.netAmount.mul(100);
    if (
      booking.currency !== 'THB' ||
      !subunits.isInteger() ||
      subunits.lt(2000) ||
      subunits.gt(15_000_000)
    ) {
      throw new ConflictException('PromptPay supports THB 20.00–150,000.00');
    }
    const id = randomUUID();
    const attempt = await this.prisma.$transaction(async (tx) => {
      // This row update serializes creation with cancellation and other payment claims.
      const claim = await tx.booking.updateMany({
        where: {
          id: bookingId,
          studentUserId,
          status: 'CONFIRMED',
          paymentStatus: 'UNPAID',
          paymentPending: false,
          netAmount: booking.netAmount,
          currency: 'THB',
        },
        data: { paymentPending: true },
      });
      if (claim.count !== 1) {
        return null;
      }
      return tx.paymentAttempt.create({
        data: { id, bookingId, amount: booking.netAmount, currency: 'THB' },
      });
    });
    if (!attempt) {
      const current = await this.ownedBooking(bookingId, studentUserId);
      if (current.paymentPending || current.paymentStatus === 'PAID') {
        return this.getStatus(bookingId, studentUserId);
      }
      throw conflict();
    }
    try {
      const charge = await this.omise.createCharge({
        amount: subunits.toNumber(),
        attemptId: id,
        bookingId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      await this.applyCharge(charge, attempt.id);
    } catch (error) {
      if (error instanceof OmiseRequestRejected) {
        await this.prisma.$transaction(async (tx) => {
          const failed = await tx.paymentAttempt.updateMany({
            where: { id, status: 'CREATING' },
            data: { status: 'FAILED', failureCode: 'provider_rejected' },
          });
          if (failed.count === 1) {
            await tx.booking.updateMany({
              where: { id: bookingId, paymentStatus: 'UNPAID' },
              data: { paymentPending: false },
            });
          }
        });
        throw new ServiceUnavailableException(
          'Omise rejected the payment request; check test account configuration and retry',
        );
      }
      // An uncertain create stays locked. A read or charge.create webhook can recover it by metadata.
      throw error;
    }
    return this.response(bookingId, studentUserId);
  }

  async getStatus(bookingId: string, studentUserId: string): Promise<PaymentResponseDto> {
    await this.ownedBooking(bookingId, studentUserId);
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { bookingId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (attempt && ACTIVE_STATUSES.some((status) => status === attempt.status)) {
      const charge = attempt.chargeId
        ? await this.omise.retrieveCharge(attempt.chargeId)
        : Date.now() - attempt.createdAt.getTime() >= 15_000
          ? await this.omise.findCharge(attempt.id, attempt.createdAt)
          : null;
      if (charge) {
        await this.applyCharge(charge, attempt.id);
      }
    }
    return this.response(bookingId, studentUserId);
  }

  async webhook(body: unknown): Promise<void> {
    if (
      !isRecord(body) ||
      body['object'] !== 'event' ||
      body['livemode'] !== false ||
      typeof body['key'] !== 'string'
    ) {
      throw new ConflictException('Invalid test payment event');
    }
    if (!['charge.create', 'charge.complete', 'charge.update'].includes(body['key'])) {
      return;
    }
    if (!isRecord(body['data']) || typeof body['data']['id'] !== 'string') {
      throw new ConflictException('Missing charge identifier');
    }
    const metadata = body['data']['metadata'];
    const localAttemptId =
      isRecord(metadata) && isUuid(metadata['attemptId']) ? metadata['attemptId'] : null;
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: localAttemptId ? { id: localAttemptId } : { chargeId: body['data']['id'] },
    });
    if (!attempt) {
      // Other applications may share this Omise test account.
      return;
    }
    // The signed payload only routes notifications. Retrieved charge data establishes payment truth.
    const charge = await this.omise.retrieveCharge(body['data']['id']);
    await this.applyCharge(charge, attempt.id);
  }

  private async applyCharge(charge: OmiseCharge, expectedAttemptId: string): Promise<void> {
    if (charge.attemptId !== expectedAttemptId) {
      throw new ConflictException('Charge belongs to a different payment attempt');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${charge.bookingId}::uuid FOR UPDATE`;
      const attempt = await tx.paymentAttempt.findUnique({ where: { id: charge.attemptId } });
      if (
        !attempt ||
        attempt.bookingId !== charge.bookingId ||
        !attempt.amount.mul(100).equals(charge.amount) ||
        attempt.currency !== charge.currency ||
        (attempt.chargeId !== null && attempt.chargeId !== charge.id)
      ) {
        throw new ConflictException('Charge does not match the payment attempt');
      }
      if (!ACTIVE_STATUSES.some((status) => status === attempt.status)) {
        return;
      }
      const status =
        charge.status === 'successful'
          ? 'SUCCESSFUL'
          : charge.status === 'failed'
            ? 'FAILED'
            : charge.status === 'expired'
              ? 'EXPIRED'
              : 'PENDING';
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status,
          chargeId: charge.id,
          qrCodeUrl: charge.qrCodeUrl,
          expiresAt: charge.expiresAt,
          paidAt: status === 'SUCCESSFUL' ? charge.paidAt : null,
          failureCode: charge.failureCode,
        },
      });
      if (status === 'PENDING') {
        return;
      }
      const updated = await tx.booking.updateMany({
        where: {
          id: attempt.bookingId,
          status: 'CONFIRMED',
          paymentStatus: 'UNPAID',
          paymentPending: true,
          netAmount: attempt.amount,
          currency: attempt.currency,
        },
        data:
          status === 'SUCCESSFUL'
            ? {
                paymentPending: false,
                paymentStatus: 'PAID',
                paidAt: charge.paidAt,
                paymentReference: charge.id,
              }
            : { paymentPending: false },
      });
      if (updated.count !== 1) {
        throw conflict();
      }
    });
  }

  private async ownedBooking(bookingId: string, studentUserId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: bookingSelect,
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.studentUserId !== studentUserId) {
      throw new ForbiddenException('This booking belongs to another student');
    }
    return booking;
  }

  private async response(bookingId: string, studentUserId: string): Promise<PaymentResponseDto> {
    const booking = await this.ownedBooking(bookingId, studentUserId);
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { bookingId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      bookingId,
      paymentStatus: booking.paymentStatus,
      paymentPending: booking.paymentPending,
      paidAt: booking.paidAt?.toISOString() ?? null,
      reference: booking.paymentReference ?? booking.mockReference,
      attempt: attempt ? this.attemptResponse(attempt) : null,
    };
  }

  private attemptResponse(attempt: PaymentAttempt) {
    return {
      id: attempt.id,
      status: attempt.status,
      amount: attempt.amount.toFixed(2),
      currency: attempt.currency,
      chargeId: attempt.chargeId,
      qrCodeUrl: attempt.status === 'PENDING' ? attempt.qrCodeUrl : null,
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
      failureCode: attempt.failureCode,
    };
  }
}

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
import { couponSnapshot, couponSnapshotSelect } from '@modules/coupons/coupon-snapshot';

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
  subtotalAmount: true,
  discountAmount: true,
  ...couponSnapshotSelect,
  currency: true,
  paidAt: true,
  mockReference: true,
  paymentReference: true,
} satisfies Prisma.BookingSelect;

type PaymentBooking = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function domainConflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

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
    const attempt = await this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId}::uuid FOR UPDATE`;
      const booking = await this.ownedBooking(bookingId, studentUserId, tx);
      if (booking.paymentStatus === 'PAID' || booking.paymentPending) {
        return null;
      }
      if (booking.status !== 'CONFIRMED') {
        throw domainConflict('BOOKING_NOT_PAYABLE', 'Only confirmed unpaid bookings are payable');
      }
      const subunits = booking.netAmount.mul(100);
      const zero = subunits.isZero();
      if (
        booking.currency !== 'THB' ||
        !subunits.isInteger() ||
        (!zero && (subunits.lt(2000) || subunits.gt(15_000_000))) ||
        (zero && (!booking.appliedCouponId || booking.appliedCouponPercent !== 100))
      ) {
        throw domainConflict('PAYMENT_AMOUNT_UNSUPPORTED', 'Unsupported payment amount');
      }
      await this.validateCoupon(tx, booking);
      await tx.$queryRaw`SELECT set_config('hktutor.audit_actor_user_id', ${studentUserId}, true)`;
      if (zero && booking.appliedCouponId) {
        const now = new Date();
        const reservation = await tx.couponReservation.create({
          data: {
            couponId: booking.appliedCouponId,
            bookingId,
            studentUserId,
            discountAmount: booking.discountAmount,
            status: 'CONSUMED',
            createdAt: now,
            consumedAt: now,
          },
        });
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            paymentStatus: 'PAID',
            paidAt: now,
            paymentReference: `coupon:${reservation.id}`,
          },
        });
        return null;
      }
      // Check configuration before claiming capacity; no provider HTTP runs in this transaction.
      this.omise.assertEnabled();
      await tx.booking.update({ where: { id: bookingId }, data: { paymentPending: true } });
      const created = await tx.paymentAttempt.create({
        data: {
          id: randomUUID(),
          bookingId,
          amount: booking.netAmount,
          currency: 'THB',
          appliedCouponId: booking.appliedCouponId,
          appliedCouponCode: booking.appliedCouponCode,
          appliedCouponPercent: booking.appliedCouponPercent,
        },
      });
      if (booking.appliedCouponId) {
        await tx.couponReservation.create({
          data: {
            couponId: booking.appliedCouponId,
            bookingId,
            studentUserId,
            paymentAttemptId: created.id,
            discountAmount: booking.discountAmount,
          },
        });
      }
      return created;
    });
    if (!attempt) {
      return this.getStatus(bookingId, studentUserId);
    }
    try {
      const charge = await this.omise.createCharge({
        amount: attempt.amount.mul(100).toNumber(),
        attemptId: attempt.id,
        bookingId,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      });
      await this.applyCharge(charge, attempt.id);
    } catch (error) {
      if (error instanceof OmiseRequestRejected) {
        await this.transaction(async (tx) => {
          await this.lockAttemptBooking(tx, attempt);
          const failed = await tx.paymentAttempt.updateMany({
            where: { id: attempt.id, status: 'CREATING' },
            data: { status: 'FAILED', failureCode: 'provider_rejected' },
          });
          if (failed.count === 1) {
            await this.finishReservation(tx, attempt, false);
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
    const expected = await this.prisma.paymentAttempt.findUnique({
      where: { id: expectedAttemptId },
    });
    if (!expected || expected.bookingId !== charge.bookingId) {
      throw conflict();
    }
    await this.transaction(async (tx) => {
      const booking = await this.lockAttemptBooking(tx, expected);
      const attempt = await tx.paymentAttempt.findUnique({ where: { id: expectedAttemptId } });
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
      if (
        !booking.netAmount.equals(attempt.amount) ||
        booking.currency !== attempt.currency ||
        booking.appliedCouponId !== attempt.appliedCouponId ||
        booking.appliedCouponCode !== attempt.appliedCouponCode ||
        booking.appliedCouponPercent !== attempt.appliedCouponPercent
      ) {
        throw conflict();
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
      await this.finishReservation(tx, attempt, status === 'SUCCESSFUL');
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

  /** Lock order is shared with the database guards: booking -> coupon -> reservation/attempt. */
  private async lockAttemptBooking(
    tx: Prisma.TransactionClient,
    attempt: PaymentAttempt,
  ): Promise<PaymentBooking> {
    await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${attempt.bookingId}::uuid FOR UPDATE`;
    if (attempt.appliedCouponId) {
      await tx.$executeRaw`UPDATE "Coupon" SET "id" = "id" WHERE "id" = ${attempt.appliedCouponId}::uuid`;
    }
    const booking = await tx.booking.findUnique({
      where: { id: attempt.bookingId },
      select: bookingSelect,
    });
    if (!booking) {
      throw conflict();
    }
    return booking;
  }

  private async validateCoupon(
    tx: Prisma.TransactionClient,
    booking: PaymentBooking,
  ): Promise<void> {
    if (!booking.appliedCouponId) {
      return;
    }
    // A forced write also invalidates older repeatable-read writers using the same capacity.
    await tx.$executeRaw`UPDATE "Coupon" SET "id" = "id" WHERE "id" = ${booking.appliedCouponId}::uuid`;
    const coupon = await tx.coupon.findUnique({
      where: { id: booking.appliedCouponId },
      select: { code: true, percent: true, active: true, expiresAt: true, maxUses: true },
    });
    if (!coupon) {
      throw conflict();
    }
    if (!coupon.active) {
      throw domainConflict('COUPON_INACTIVE', 'Coupon is inactive');
    }
    if (coupon.expiresAt.getTime() <= Date.now()) {
      throw domainConflict('COUPON_EXPIRED', 'Coupon has expired');
    }
    const discount = booking.subtotalAmount
      .mul(coupon.percent)
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (
      coupon.code !== booking.appliedCouponCode ||
      coupon.percent !== booking.appliedCouponPercent ||
      !discount.equals(booking.discountAmount) ||
      !booking.subtotalAmount.minus(discount).equals(booking.netAmount)
    ) {
      throw conflict();
    }
    const claimed = await tx.couponReservation.findFirst({
      where: {
        couponId: booking.appliedCouponId,
        studentUserId: booking.studentUserId,
        status: { in: ['RESERVED', 'CONSUMED'] },
      },
      select: { id: true },
    });
    const used = await tx.couponUse.findUnique({
      where: {
        couponId_studentUserId: {
          couponId: booking.appliedCouponId,
          studentUserId: booking.studentUserId,
        },
      },
      select: { id: true },
    });
    if (claimed || used) {
      throw domainConflict('COUPON_ALREADY_USED', 'Coupon is already claimed by this student');
    }
    const consumed = await tx.couponUse.count({ where: { couponId: booking.appliedCouponId } });
    const reserved = await tx.couponReservation.count({
      where: { couponId: booking.appliedCouponId, status: 'RESERVED' },
    });
    if (consumed + reserved >= coupon.maxUses) {
      throw domainConflict('COUPON_EXHAUSTED', 'Coupon capacity is exhausted');
    }
  }

  private async finishReservation(
    tx: Prisma.TransactionClient,
    attempt: PaymentAttempt,
    successful: boolean,
  ): Promise<void> {
    if (!attempt.appliedCouponId) {
      return;
    }
    const reservation = await tx.couponReservation.findUnique({
      where: { paymentAttemptId: attempt.id },
    });
    if (
      !reservation ||
      reservation.status !== 'RESERVED' ||
      reservation.couponId !== attempt.appliedCouponId
    ) {
      throw conflict();
    }
    const now = new Date(Math.max(Date.now(), reservation.createdAt.getTime()));
    await tx.couponReservation.update({
      where: { id: reservation.id },
      data: successful
        ? { status: 'CONSUMED', consumedAt: now }
        : { status: 'RELEASED', releasedAt: now },
    });
  }

  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry += 1) {
      try {
        return await this.prisma.$transaction(run);
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          retry >= 2
        ) {
          throw error;
        }
      }
    }
  }

  private async ownedBooking(
    bookingId: string,
    studentUserId: string,
    database: Pick<Prisma.TransactionClient, 'booking'> = this.prisma,
  ) {
    const booking = await database.booking.findUnique({
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
    return this.prisma.$transaction(
      async (tx) => {
        const booking = await this.ownedBooking(bookingId, studentUserId, tx);
        const attempt = await tx.paymentAttempt.findFirst({
          where: { bookingId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return {
          bookingId,
          subtotalAmount: booking.subtotalAmount.toFixed(2),
          discountAmount: booking.discountAmount.toFixed(2),
          netAmount: booking.netAmount.toFixed(2),
          currency: booking.currency,
          coupon: couponSnapshot(booking),
          paymentStatus: booking.paymentStatus,
          paymentPending: booking.paymentPending,
          paidAt: booking.paidAt?.toISOString() ?? null,
          reference: booking.paymentReference ?? booking.mockReference,
          attempt:
            attempt && !booking.paymentReference?.startsWith('coupon:')
              ? this.attemptResponse(attempt)
              : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private attemptResponse(attempt: PaymentAttempt) {
    return {
      id: attempt.id,
      status: attempt.status,
      amount: attempt.amount.toFixed(2),
      coupon: couponSnapshot(attempt),
      currency: attempt.currency,
      chargeId: attempt.chargeId,
      qrCodeUrl: attempt.status === 'PENDING' ? attempt.qrCodeUrl : null,
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
      failureCode: attempt.failureCode,
    };
  }
}

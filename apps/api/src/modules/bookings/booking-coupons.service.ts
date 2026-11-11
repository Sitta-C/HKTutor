import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import {
  BookingStatus,
  CouponReservationStatus,
  PaymentAttemptStatus,
  PaymentStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { couponSnapshot } from '@modules/coupons/coupon-snapshot';

import type {
  BookingCouponCodeDto,
  BookingCouponOperationResponseDto,
  BookingCouponQuoteResponseDto,
} from '@modules/bookings/bookings.dto';

const bookingCouponSelect = {
  appliedCouponId: true,
  appliedCouponCode: true,
  appliedCouponPercent: true,
  currency: true,
  discountAmount: true,
  id: true,
  netAmount: true,
  paymentPending: true,
  paymentStatus: true,
  status: true,
  studentUserId: true,
  subtotalAmount: true,
} satisfies Prisma.BookingSelect;

type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingCouponSelect }>;

const couponEligibilitySelect = {
  active: true,
  code: true,
  expiresAt: true,
  id: true,
  maxUses: true,
  percent: true,
} satisfies Prisma.CouponSelect;

type CouponRecord = Prisma.CouponGetPayload<{ select: typeof couponEligibilitySelect }>;

type DatabaseClient = Prisma.TransactionClient | PrismaService;

export function calculateCouponDiscount(
  subtotalAmount: Prisma.Decimal,
  percent: number,
): { discountAmount: Prisma.Decimal; netAmount: Prisma.Decimal } {
  const rawDiscount = subtotalAmount
    .mul(percent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const discountAmount = rawDiscount.greaterThan(subtotalAmount) ? subtotalAmount : rawDiscount;
  const netAmount = subtotalAmount.sub(discountAmount);
  return { discountAmount, netAmount };
}

export function assertSupportedPaymentAmount(netAmount: Prisma.Decimal): void {
  if (netAmount.equals(0)) {
    return;
  }
  const subunits = netAmount.mul(100);
  if (!subunits.isInteger() || subunits.lt(2000) || subunits.gt(15_000_000)) {
    throw new ConflictException({
      code: 'PAYMENT_AMOUNT_UNSUPPORTED',
      message: 'PromptPay supports THB 20.00–150,000.00',
    });
  }
}

function assertBookingOwnership(booking: BookingRecord, studentUserId: string): void {
  if (booking.studentUserId !== studentUserId) {
    throw new ForbiddenException({
      code: 'BOOKING_NOT_OWNED',
      message: 'This booking belongs to another student',
    });
  }
}

function assertPayableBooking(booking: BookingRecord): void {
  if (booking.status !== BookingStatus.CONFIRMED || booking.paymentStatus === PaymentStatus.PAID) {
    throw new ConflictException({
      code: 'BOOKING_NOT_PAYABLE',
      message: 'Booking is not payable',
    });
  }
}

async function assertNoActivePayment(
  database: DatabaseClient,
  booking: BookingRecord,
): Promise<void> {
  if (booking.paymentPending) {
    throw new ConflictException({
      code: 'PAYMENT_IN_PROGRESS',
      message: 'A payment is currently in progress',
    });
  }
  const activeAttempt = await database.paymentAttempt.findFirst({
    where: {
      bookingId: booking.id,
      status: { in: [PaymentAttemptStatus.CREATING, PaymentAttemptStatus.PENDING] },
    },
    select: { id: true },
  });
  if (activeAttempt) {
    throw new ConflictException({
      code: 'PAYMENT_IN_PROGRESS',
      message: 'A payment is currently in progress',
    });
  }
  const activeReservation = await database.couponReservation.findFirst({
    where: {
      bookingId: booking.id,
      status: CouponReservationStatus.RESERVED,
    },
    select: { id: true },
  });
  if (activeReservation) {
    throw new ConflictException({
      code: 'PAYMENT_IN_PROGRESS',
      message: 'A payment is currently in progress',
    });
  }
}

async function validateCouponEligibility(
  database: DatabaseClient,
  code: string,
  studentUserId: string,
  bookingId: string,
): Promise<CouponRecord> {
  const normalizedCode = code.trim().toUpperCase();
  const coupon = await database.coupon.findUnique({
    where: { code: normalizedCode },
    select: couponEligibilitySelect,
  });
  if (!coupon) {
    throw new NotFoundException({
      code: 'COUPON_NOT_FOUND',
      message: 'Coupon not found',
    });
  }
  if (!coupon.active) {
    throw new ConflictException({
      code: 'COUPON_INACTIVE',
      message: 'Coupon is inactive',
    });
  }
  if (coupon.expiresAt.getTime() <= Date.now()) {
    throw new ConflictException({
      code: 'COUPON_EXPIRED',
      message: 'Coupon has expired',
    });
  }

  const existingUse = await database.couponUse.findUnique({
    where: {
      couponId_studentUserId: {
        couponId: coupon.id,
        studentUserId,
      },
    },
    select: { id: true },
  });
  if (existingUse) {
    throw new ConflictException({
      code: 'COUPON_ALREADY_USED',
      message: 'Coupon has already been used by this student',
    });
  }

  const existingReservation = await database.couponReservation.findFirst({
    where: {
      couponId: coupon.id,
      studentUserId,
      status: CouponReservationStatus.RESERVED,
      bookingId: { not: bookingId },
    },
    select: { id: true },
  });
  if (existingReservation) {
    throw new ConflictException({
      code: 'COUPON_ALREADY_USED',
      message: 'Coupon has already been used by this student',
    });
  }

  const consumedUses = await database.couponUse.count({
    where: { couponId: coupon.id },
  });
  const reservedUses = await database.couponReservation.count({
    where: {
      couponId: coupon.id,
      status: CouponReservationStatus.RESERVED,
    },
  });
  if (consumedUses + reservedUses >= coupon.maxUses) {
    throw new ConflictException({
      code: 'COUPON_EXHAUSTED',
      message: 'Coupon usage limit reached',
    });
  }

  return coupon;
}

function toOperationDto(booking: BookingRecord): BookingCouponOperationResponseDto {
  return {
    bookingId: booking.id,
    coupon: couponSnapshot(booking),
    currency: booking.currency,
    discountAmount: booking.discountAmount.toFixed(2),
    netAmount: booking.netAmount.toFixed(2),
    paymentPending: booking.paymentPending,
    paymentStatus: booking.paymentStatus,
    subtotalAmount: booking.subtotalAmount.toFixed(2),
  };
}

@Injectable()
export class BookingCouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async quoteCoupon(
    bookingId: string,
    studentUserId: string,
    dto: BookingCouponCodeDto,
  ): Promise<BookingCouponQuoteResponseDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: bookingCouponSelect,
    });
    if (!booking) {
      throw new NotFoundException({
        code: 'BOOKING_NOT_FOUND',
        message: 'Booking not found',
      });
    }
    assertBookingOwnership(booking, studentUserId);
    assertPayableBooking(booking);
    await assertNoActivePayment(this.prisma, booking);

    const coupon = await validateCouponEligibility(this.prisma, dto.code, studentUserId, bookingId);

    const { discountAmount, netAmount } = calculateCouponDiscount(
      booking.subtotalAmount,
      coupon.percent,
    );
    assertSupportedPaymentAmount(netAmount);

    return {
      bookingId: booking.id,
      coupon: {
        code: coupon.code,
        id: coupon.id,
        percent: coupon.percent,
      },
      currency: booking.currency,
      discountAmount: discountAmount.toFixed(2),
      netAmount: netAmount.toFixed(2),
      quotedAt: new Date().toISOString(),
      subtotalAmount: booking.subtotalAmount.toFixed(2),
    };
  }

  async applyCoupon(
    bookingId: string,
    studentUserId: string,
    dto: BookingCouponCodeDto,
  ): Promise<BookingCouponOperationResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId}::uuid FOR UPDATE`;

      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: bookingCouponSelect,
      });
      if (!booking) {
        throw new NotFoundException({
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
        });
      }
      assertBookingOwnership(booking, studentUserId);
      assertPayableBooking(booking);
      await assertNoActivePayment(tx, booking);

      const normalizedCode = dto.code.trim().toUpperCase();
      const existingCoupon = await tx.coupon.findUnique({
        where: { code: normalizedCode },
        select: { id: true },
      });
      if (!existingCoupon) {
        throw new NotFoundException({
          code: 'COUPON_NOT_FOUND',
          message: 'Coupon not found',
        });
      }

      await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${existingCoupon.id}::uuid FOR UPDATE`;

      const coupon = await validateCouponEligibility(tx, dto.code, studentUserId, bookingId);

      const { discountAmount, netAmount } = calculateCouponDiscount(
        booking.subtotalAmount,
        coupon.percent,
      );
      assertSupportedPaymentAmount(netAmount);

      if (
        booking.appliedCouponId === coupon.id &&
        booking.appliedCouponCode === coupon.code &&
        booking.appliedCouponPercent === coupon.percent &&
        booking.discountAmount.equals(discountAmount) &&
        booking.netAmount.equals(netAmount)
      ) {
        return toOperationDto(booking);
      }

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          appliedCouponCode: coupon.code,
          appliedCouponId: coupon.id,
          appliedCouponPercent: coupon.percent,
          discountAmount,
          netAmount,
        },
        select: bookingCouponSelect,
      });

      return toOperationDto(updated);
    });
  }

  async removeCoupon(
    bookingId: string,
    studentUserId: string,
  ): Promise<BookingCouponOperationResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId}::uuid FOR UPDATE`;

      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: bookingCouponSelect,
      });
      if (!booking) {
        throw new NotFoundException({
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
        });
      }
      assertBookingOwnership(booking, studentUserId);
      assertPayableBooking(booking);
      await assertNoActivePayment(tx, booking);

      if (!booking.appliedCouponId) {
        return toOperationDto(booking);
      }

      const restoredAmount = booking.subtotalAmount;
      assertSupportedPaymentAmount(restoredAmount);

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          appliedCouponCode: null,
          appliedCouponId: null,
          appliedCouponPercent: null,
          discountAmount: new Prisma.Decimal(0),
          netAmount: restoredAmount,
        },
        select: bookingCouponSelect,
      });

      return toOperationDto(updated);
    });
  }
}

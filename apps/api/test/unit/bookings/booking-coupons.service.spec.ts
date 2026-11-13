import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { BookingStatus, PaymentStatus } from '@generated/prisma/enums';
import {
  assertSupportedPaymentAmount,
  BookingCouponsService,
  calculateCouponDiscount,
} from '@modules/bookings/booking-coupons.service';

import type { PrismaService } from '@infrastructure/database/prisma.service';

describe('BookingCouponsService', () => {
  describe('calculateCouponDiscount', () => {
    it('calculates 10% discount on 450.00 to equal 45.00 discount and 405.00 net', () => {
      const { discountAmount, netAmount } = calculateCouponDiscount(new Prisma.Decimal(450), 10);
      expect(discountAmount.toFixed(2)).toBe('45.00');
      expect(netAmount.toFixed(2)).toBe('405.00');
    });

    it('calculates 1% discount on 450.00 to equal 4.50 discount and 445.50 net', () => {
      const { discountAmount, netAmount } = calculateCouponDiscount(new Prisma.Decimal(450), 1);
      expect(discountAmount.toFixed(2)).toBe('4.50');
      expect(netAmount.toFixed(2)).toBe('445.50');
    });

    it('calculates 100% discount on 450.00 to equal 450.00 discount and 0.00 net', () => {
      const { discountAmount, netAmount } = calculateCouponDiscount(new Prisma.Decimal(450), 100);
      expect(discountAmount.toFixed(2)).toBe('450.00');
      expect(netAmount.toFixed(2)).toBe('0.00');
    });

    it('rounds using HALF_UP at the third decimal place (0.005 rounds up)', () => {
      // 105.50 * 3% = 3.165 -> 3.17
      const { discountAmount: d1, netAmount: n1 } = calculateCouponDiscount(
        new Prisma.Decimal('105.50'),
        3,
      );
      expect(d1.toFixed(2)).toBe('3.17');
      expect(n1.toFixed(2)).toBe('102.33');

      // 105.10 * 3% = 3.153 -> 3.15
      const { discountAmount: d2, netAmount: n2 } = calculateCouponDiscount(
        new Prisma.Decimal('105.10'),
        3,
      );
      expect(d2.toFixed(2)).toBe('3.15');
      expect(n2.toFixed(2)).toBe('101.95');
    });

    it('caps discount at subtotal amount', () => {
      const { discountAmount, netAmount } = calculateCouponDiscount(new Prisma.Decimal(100), 105);
      expect(discountAmount.toFixed(2)).toBe('100.00');
      expect(netAmount.toFixed(2)).toBe('0.00');
    });
  });

  describe('assertSupportedPaymentAmount', () => {
    it('accepts zero net amount for approved full-coupon settlement (percent === 100)', () => {
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal(0), 100)).not.toThrow();
    });

    it('rejects zero net amount when coupon is not 100%', () => {
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal(0), 99)).toThrow(
        new ConflictException({
          code: 'PAYMENT_AMOUNT_UNSUPPORTED',
          message: 'PromptPay supports THB 20.00–150,000.00',
        }),
      );
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal(0), null)).toThrow(
        new ConflictException({
          code: 'PAYMENT_AMOUNT_UNSUPPORTED',
          message: 'PromptPay supports THB 20.00–150,000.00',
        }),
      );
    });

    it('accepts valid amounts within THB 20.00 to 150,000.00', () => {
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal('20.00'))).not.toThrow();
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal('405.00'))).not.toThrow();
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal('150000.00'))).not.toThrow();
    });

    it.each(['0.01', '15.00', '19.99'])(
      'rejects net amount %s because 0 < net < 20 is unsupported',
      (amount) => {
        expect(() => assertSupportedPaymentAmount(new Prisma.Decimal(amount))).toThrow(
          new ConflictException({
            code: 'PAYMENT_AMOUNT_UNSUPPORTED',
            message: 'PromptPay supports THB 20.00–150,000.00',
          }),
        );
      },
    );

    it('rejects net amounts strictly greater than 150,000.00', () => {
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal('150000.01'))).toThrow(
        new ConflictException({
          code: 'PAYMENT_AMOUNT_UNSUPPORTED',
          message: 'PromptPay supports THB 20.00–150,000.00',
        }),
      );
    });

    it('rejects net amounts with more than two decimal places', () => {
      expect(() => assertSupportedPaymentAmount(new Prisma.Decimal('45.005'))).toThrow(
        new ConflictException({
          code: 'PAYMENT_AMOUNT_UNSUPPORTED',
          message: 'PromptPay supports THB 20.00–150,000.00',
        }),
      );
    });
  });

  describe('BookingCouponsService operations', () => {
    const studentUserId = '11111111-1111-4111-8111-111111111111';
    const otherStudentUserId = '22222222-2222-4222-8222-222222222222';
    const bookingId = '33333333-3333-4333-8333-333333333333';
    const couponId = '44444444-4444-4444-8444-444444444444';

    function createMockPrisma() {
      const mockBookingFindUnique = jest.fn();
      const mockBookingUpdate = jest.fn();
      const mockCouponFindUnique = jest.fn();
      const mockCouponUseFindUnique = jest.fn();
      const mockCouponUseCount = jest.fn();
      const mockCouponReservationFindFirst = jest.fn();
      const mockCouponReservationCount = jest.fn();
      const mockPaymentAttemptFindFirst = jest.fn();
      const mockQueryRaw = jest.fn();
      const mockTransaction = jest.fn();

      const tx = {
        $queryRaw: mockQueryRaw,
        booking: {
          findUnique: mockBookingFindUnique,
          update: mockBookingUpdate,
        },
        coupon: {
          findUnique: mockCouponFindUnique,
        },
        couponReservation: {
          count: mockCouponReservationCount,
          findFirst: mockCouponReservationFindFirst,
        },
        couponUse: {
          count: mockCouponUseCount,
          findUnique: mockCouponUseFindUnique,
        },
        paymentAttempt: {
          findFirst: mockPaymentAttemptFindFirst,
        },
      };

      mockTransaction.mockImplementation(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      );

      const prisma = {
        ...tx,
        $transaction: mockTransaction,
      } as unknown as PrismaService;

      return {
        mockBookingFindUnique,
        mockBookingUpdate,
        mockCouponFindUnique,
        mockCouponReservationCount,
        mockCouponReservationFindFirst,
        mockCouponUseCount,
        mockCouponUseFindUnique,
        mockPaymentAttemptFindFirst,
        mockQueryRaw,
        mockTransaction,
        prisma,
        tx,
      };
    }

    function baseBookingRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        appliedCouponCode: null,
        appliedCouponId: null,
        appliedCouponPercent: null,
        currency: 'THB',
        discountAmount: new Prisma.Decimal(0),
        id: bookingId,
        netAmount: new Prisma.Decimal(450),
        paymentPending: false,
        paymentStatus: PaymentStatus.UNPAID,
        slot: { startAtUtc: new Date(Date.now() + 24 * 3_600_000) },
        status: BookingStatus.CONFIRMED,
        studentUserId,
        subtotalAmount: new Prisma.Decimal(450),
        ...overrides,
      };
    }

    function baseCouponRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        _count: {
          reservations: 0,
          uses: 0,
        },
        active: true,
        code: 'WELCOME10',
        expiresAt: new Date(Date.now() + 86400000),
        id: couponId,
        maxUses: 100,
        percent: 10,
        ...overrides,
      };
    }

    describe('lesson-start deadline across asynchronous coupon operations', () => {
      const now = new Date('2026-11-15T10:59:59.999Z');
      const startAtUtc = new Date('2026-11-15T11:00:00.000Z');
      let database: ReturnType<typeof createMockPrisma>;
      let service: BookingCouponsService;

      function appliedBooking() {
        return baseBookingRow({
          slot: { startAtUtc },
          appliedCouponId: couponId,
          appliedCouponCode: 'WELCOME10',
          appliedCouponPercent: 10,
          discountAmount: new Prisma.Decimal(45),
          netAmount: new Prisma.Decimal(405),
        });
      }

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(now);
        database = createMockPrisma();
        database.mockBookingFindUnique.mockResolvedValue(appliedBooking());
        database.mockBookingUpdate.mockResolvedValue(baseBookingRow({ slot: { startAtUtc } }));
        database.mockPaymentAttemptFindFirst.mockResolvedValue(null);
        database.mockCouponReservationFindFirst.mockResolvedValue(null);
        database.mockCouponFindUnique.mockResolvedValue(baseCouponRow());
        database.mockCouponUseFindUnique.mockResolvedValue(null);
        database.mockCouponUseCount.mockResolvedValue(0);
        database.mockCouponReservationCount.mockResolvedValue(0);
        service = new BookingCouponsService(database.prisma);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('removes a coupon successfully one millisecond before lesson start', async () => {
        await expect(service.removeCoupon(bookingId, studentUserId)).resolves.toMatchObject({
          coupon: null,
          discountAmount: '0.00',
          netAmount: '450.00',
        });
        expect(database.mockBookingUpdate).toHaveBeenCalledTimes(1);
      });

      it.each([0, 1])('rejects removal %d ms after start without a write', async (offset) => {
        jest.setSystemTime(new Date(startAtUtc.getTime() + offset));
        await expect(service.removeCoupon(bookingId, studentUserId)).rejects.toMatchObject({
          response: { code: 'BOOKING_PAYMENT_DEADLINE_PASSED' },
        });
        expect(database.mockBookingUpdate).not.toHaveBeenCalled();
      });

      it.each(['attempt', 'reservation'] as const)(
        'rejects removal when the deadline passes during the %s read',
        async (read) => {
          const query =
            read === 'attempt'
              ? database.mockPaymentAttemptFindFirst
              : database.mockCouponReservationFindFirst;
          query.mockImplementation(() => {
            jest.setSystemTime(startAtUtc);
            return Promise.resolve(null);
          });
          await expect(service.removeCoupon(bookingId, studentUserId)).rejects.toMatchObject({
            response: { code: 'BOOKING_PAYMENT_DEADLINE_PASSED' },
          });
          expect(database.mockBookingUpdate).not.toHaveBeenCalled();
        },
      );

      it('also rejects an idempotent removal if its eligibility reads cross the deadline', async () => {
        database.mockBookingFindUnique.mockResolvedValue(baseBookingRow({ slot: { startAtUtc } }));
        database.mockPaymentAttemptFindFirst.mockImplementation(() => {
          jest.setSystemTime(startAtUtc);
          return Promise.resolve(null);
        });
        await expect(service.removeCoupon(bookingId, studentUserId)).rejects.toMatchObject({
          response: { code: 'BOOKING_PAYMENT_DEADLINE_PASSED' },
        });
        expect(database.mockBookingUpdate).not.toHaveBeenCalled();
      });

      it.each(['apply', 'remove'] as const)(
        'rejects the transaction when %s crosses the deadline while awaiting its write',
        async (operation) => {
          if (operation === 'apply') {
            database.mockBookingFindUnique.mockResolvedValue(
              baseBookingRow({ slot: { startAtUtc } }),
            );
          }
          database.mockBookingUpdate.mockImplementation(() => {
            jest.setSystemTime(new Date(startAtUtc.getTime() + 1));
            return Promise.resolve(
              operation === 'apply' ? appliedBooking() : baseBookingRow({ slot: { startAtUtc } }),
            );
          });
          const result =
            operation === 'apply'
              ? service.applyCoupon(bookingId, studentUserId, { code: 'WELCOME10' })
              : service.removeCoupon(bookingId, studentUserId);
          await expect(result).rejects.toMatchObject({
            response: { code: 'BOOKING_PAYMENT_DEADLINE_PASSED' },
          });
          expect(database.mockBookingUpdate).toHaveBeenCalledTimes(1);
          await expect(database.mockTransaction.mock.results[0]?.value).rejects.toMatchObject({
            response: { code: 'BOOKING_PAYMENT_DEADLINE_PASSED' },
          });
        },
      );

      it.each(['quote', 'apply'] as const)(
        'rejects %s when coupon eligibility reads reach lesson start',
        async (operation) => {
          database.mockCouponUseFindUnique.mockImplementation(() => {
            jest.setSystemTime(startAtUtc);
            return Promise.resolve(null);
          });
          const result =
            operation === 'quote'
              ? service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' })
              : service.applyCoupon(bookingId, studentUserId, { code: 'WELCOME10' });
          await expect(result).rejects.toMatchObject({
            response: { code: 'BOOKING_PAYMENT_DEADLINE_PASSED' },
          });
          expect(database.mockBookingUpdate).not.toHaveBeenCalled();
        },
      );
    });

    describe('quoteCoupon', () => {
      it('calculates and returns a coupon preview without modifying database rows', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponFindUnique,
          mockCouponReservationCount,
          mockCouponReservationFindFirst,
          mockCouponUseCount,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow());
        mockCouponUseFindUnique.mockResolvedValue(null);
        mockCouponUseCount.mockResolvedValue(5);
        mockCouponReservationCount.mockResolvedValue(2);

        const service = new BookingCouponsService(prisma);
        const result = await service.quoteCoupon(bookingId, studentUserId, { code: 'welcome10' });

        expect(result).toMatchObject({
          bookingId,
          coupon: { code: 'WELCOME10', id: couponId, percent: 10 },
          currency: 'THB',
          discountAmount: '45.00',
          netAmount: '405.00',
          subtotalAmount: '450.00',
        });
        expect(result.quotedAt).toBeDefined();
        expect(mockBookingUpdate).not.toHaveBeenCalled();
      });

      it('throws 404 BOOKING_NOT_FOUND when booking does not exist', async () => {
        const { mockBookingFindUnique, prisma } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(null);

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' }),
        );
      });

      it('throws 403 BOOKING_NOT_OWNED when booking belongs to another student', async () => {
        const { mockBookingFindUnique, prisma } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({ studentUserId: otherStudentUserId }),
        );

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ForbiddenException({
            code: 'BOOKING_NOT_OWNED',
            message: 'This booking belongs to another student',
          }),
        );
      });

      it.each([BookingStatus.PENDING, BookingStatus.CANCELED, BookingStatus.COMPLETED])(
        'throws 409 BOOKING_NOT_PAYABLE when booking status is %s',
        async (status) => {
          const { mockBookingFindUnique, prisma } = createMockPrisma();
          mockBookingFindUnique.mockResolvedValue(baseBookingRow({ status }));

          const service = new BookingCouponsService(prisma);
          await expect(
            service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
          ).rejects.toThrow(
            new ConflictException({
              code: 'BOOKING_NOT_PAYABLE',
              message: 'Booking is not payable',
            }),
          );
        },
      );

      it('throws 409 BOOKING_NOT_PAYABLE when booking is already paid', async () => {
        const { mockBookingFindUnique, prisma } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({ paymentStatus: PaymentStatus.PAID }),
        );

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'BOOKING_NOT_PAYABLE',
            message: 'Booking is not payable',
          }),
        );
      });

      it('throws 409 PAYMENT_IN_PROGRESS when paymentPending is true', async () => {
        const { mockBookingFindUnique, prisma } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow({ paymentPending: true }));

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_IN_PROGRESS',
            message: 'A payment is currently in progress',
          }),
        );
      });

      it('throws 409 PAYMENT_IN_PROGRESS when an active payment attempt exists', async () => {
        const { mockBookingFindUnique, mockPaymentAttemptFindFirst, prisma } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue({ id: 'attempt-1' });

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_IN_PROGRESS',
            message: 'A payment is currently in progress',
          }),
        );
      });

      it('throws 409 PAYMENT_IN_PROGRESS when an active coupon reservation exists', async () => {
        const {
          mockBookingFindUnique,
          mockCouponReservationFindFirst,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue({ id: 'reservation-1' });

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_IN_PROGRESS',
            message: 'A payment is currently in progress',
          }),
        );
      });

      it('throws 404 COUPON_NOT_FOUND when coupon code does not exist', async () => {
        const {
          mockBookingFindUnique,
          mockCouponFindUnique,
          mockCouponReservationFindFirst,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(null);

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'NOT_EXIST' }),
        ).rejects.toThrow(
          new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Coupon not found' }),
        );
      });

      it('throws 409 COUPON_INACTIVE when coupon active flag is false', async () => {
        const {
          mockBookingFindUnique,
          mockCouponFindUnique,
          mockCouponReservationFindFirst,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow({ active: false }));

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({ code: 'COUPON_INACTIVE', message: 'Coupon is inactive' }),
        );
      });

      it('throws 409 COUPON_EXPIRED when coupon has already expired', async () => {
        const {
          mockBookingFindUnique,
          mockCouponFindUnique,
          mockCouponReservationFindFirst,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(
          baseCouponRow({ expiresAt: new Date(Date.now() - 1000) }),
        );

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({ code: 'COUPON_EXPIRED', message: 'Coupon has expired' }),
        );
      });

      it('throws 409 COUPON_ALREADY_USED when the student already used this coupon', async () => {
        const {
          mockBookingFindUnique,
          mockCouponFindUnique,
          mockCouponReservationFindFirst,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow());
        mockCouponUseFindUnique.mockResolvedValue({ id: 'use-1' });

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'COUPON_ALREADY_USED',
            message: 'Coupon has already been used by this student',
          }),
        );
      });

      it('throws 409 COUPON_ALREADY_USED when the student has an active reservation on another booking', async () => {
        const {
          mockBookingFindUnique,
          mockCouponFindUnique,
          mockCouponReservationFindFirst,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst
          .mockResolvedValueOnce(null) // no reservation on current booking
          .mockResolvedValueOnce({ id: 'other-reservation' }); // reservation on another booking
        mockCouponFindUnique.mockResolvedValue(baseCouponRow());
        mockCouponUseFindUnique.mockResolvedValue(null);

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'COUPON_ALREADY_USED',
            message: 'Coupon has already been used by this student',
          }),
        );
      });

      it('throws 409 COUPON_EXHAUSTED when coupon maxUses is reached', async () => {
        const {
          mockBookingFindUnique,
          mockCouponFindUnique,
          mockCouponReservationFindFirst,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(
          baseCouponRow({ maxUses: 10, _count: { reservations: 2, uses: 8 } }),
        );
        mockCouponUseFindUnique.mockResolvedValue(null);

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'COUPON_EXHAUSTED',
            message: 'Coupon usage limit reached',
          }),
        );
      });

      it('throws 409 PAYMENT_AMOUNT_UNSUPPORTED when calculated net amount is between 0 and 20 THB', async () => {
        const {
          mockBookingFindUnique,
          mockCouponFindUnique,
          mockCouponReservationCount,
          mockCouponReservationFindFirst,
          mockCouponUseCount,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();
        // subtotal 100 with 85% discount = net 15.00
        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({ subtotalAmount: new Prisma.Decimal(100) }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow({ percent: 85 }));
        mockCouponUseFindUnique.mockResolvedValue(null);
        mockCouponUseCount.mockResolvedValue(0);
        mockCouponReservationCount.mockResolvedValue(0);

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME85' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_AMOUNT_UNSUPPORTED',
            message: 'PromptPay supports THB 20.00–150,000.00',
          }),
        );
      });

      it('rejects rounding-induced zero net amount for non-100% coupon with 409 PAYMENT_AMOUNT_UNSUPPORTED', async () => {
        const { mockBookingFindUnique, mockCouponFindUnique, mockPaymentAttemptFindFirst, prisma } =
          createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({ subtotalAmount: new Prisma.Decimal('0.50') }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow({ percent: 99 }));

        const service = new BookingCouponsService(prisma);
        await expect(
          service.quoteCoupon(bookingId, studentUserId, { code: 'WELCOME99' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_AMOUNT_UNSUPPORTED',
            message: 'PromptPay supports THB 20.00–150,000.00',
          }),
        );
      });
    });

    describe('applyCoupon', () => {
      it('locks booking then coupon, calculates discount, and writes snapshot atomically', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponFindUnique,
          mockCouponReservationCount,
          mockCouponReservationFindFirst,
          mockCouponUseCount,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          mockQueryRaw,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow());
        mockCouponUseFindUnique.mockResolvedValue(null);
        mockCouponUseCount.mockResolvedValue(1);
        mockCouponReservationCount.mockResolvedValue(0);
        mockBookingUpdate.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'WELCOME10',
            appliedCouponId: couponId,
            appliedCouponPercent: 10,
            discountAmount: new Prisma.Decimal(45),
            netAmount: new Prisma.Decimal(405),
          }),
        );

        const service = new BookingCouponsService(prisma);
        const result = await service.applyCoupon(bookingId, studentUserId, { code: 'welcome10' });

        expect(mockQueryRaw).toHaveBeenCalledTimes(2);
        expect(mockBookingUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              appliedCouponCode: 'WELCOME10',
              appliedCouponId: couponId,
              appliedCouponPercent: 10,
              discountAmount: new Prisma.Decimal(45),
              netAmount: new Prisma.Decimal(405),
            },
            where: { id: bookingId },
          }),
        );
        expect(result).toMatchObject({
          bookingId,
          coupon: { code: 'WELCOME10', id: couponId, percent: 10 },
          discountAmount: '45.00',
          netAmount: '405.00',
          paymentPending: false,
          paymentStatus: PaymentStatus.UNPAID,
          subtotalAmount: '450.00',
        });
      });

      it('returns 200 unchanged when applying the same valid coupon code twice (idempotency)', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponFindUnique,
          mockCouponReservationCount,
          mockCouponReservationFindFirst,
          mockCouponUseCount,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'WELCOME10',
            appliedCouponId: couponId,
            appliedCouponPercent: 10,
            discountAmount: new Prisma.Decimal(45),
            netAmount: new Prisma.Decimal(405),
          }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow());
        mockCouponUseFindUnique.mockResolvedValue(null);
        mockCouponUseCount.mockResolvedValue(1);
        mockCouponReservationCount.mockResolvedValue(0);

        const service = new BookingCouponsService(prisma);
        const result = await service.applyCoupon(bookingId, studentUserId, { code: 'welcome10' });

        expect(mockBookingUpdate).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          bookingId,
          coupon: { code: 'WELCOME10', id: couponId, percent: 10 },
          discountAmount: '45.00',
          netAmount: '405.00',
        });
      });

      it('replaces an existing coupon with a different valid coupon', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponFindUnique,
          mockCouponReservationCount,
          mockCouponReservationFindFirst,
          mockCouponUseCount,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        const oldCouponId = '55555555-5555-5555-8555-555555555555';
        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'OLD5',
            appliedCouponId: oldCouponId,
            appliedCouponPercent: 5,
            discountAmount: new Prisma.Decimal('22.50'),
            netAmount: new Prisma.Decimal('427.50'),
          }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow({ code: 'WELCOME10', percent: 10 }));
        mockCouponUseFindUnique.mockResolvedValue(null);
        mockCouponUseCount.mockResolvedValue(0);
        mockCouponReservationCount.mockResolvedValue(0);
        mockBookingUpdate.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'WELCOME10',
            appliedCouponId: couponId,
            appliedCouponPercent: 10,
            discountAmount: new Prisma.Decimal(45),
            netAmount: new Prisma.Decimal(405),
          }),
        );

        const service = new BookingCouponsService(prisma);
        const result = await service.applyCoupon(bookingId, studentUserId, { code: 'WELCOME10' });

        expect(mockBookingUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              appliedCouponCode: 'WELCOME10',
              appliedCouponId: couponId,
              appliedCouponPercent: 10,
              discountAmount: new Prisma.Decimal(45),
              netAmount: new Prisma.Decimal(405),
            },
          }),
        );
        expect(result.coupon?.code).toBe('WELCOME10');
      });

      it('preserves prior snapshot when replacement coupon validation fails', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'WELCOME10',
            appliedCouponId: couponId,
            appliedCouponPercent: 10,
            discountAmount: new Prisma.Decimal(45),
            netAmount: new Prisma.Decimal(405),
          }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(null); // non-existent new coupon

        const service = new BookingCouponsService(prisma);
        await expect(
          service.applyCoupon(bookingId, studentUserId, { code: 'INVALID_COUPON' }),
        ).rejects.toThrow(
          new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Coupon not found' }),
        );

        expect(mockBookingUpdate).not.toHaveBeenCalled();
      });

      it('applies a 100% coupon resulting in valid 0.00 net amount', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponFindUnique,
          mockCouponReservationCount,
          mockCouponReservationFindFirst,
          mockCouponUseCount,
          mockCouponUseFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow({ code: 'FREE100', percent: 100 }));
        mockCouponUseFindUnique.mockResolvedValue(null);
        mockCouponUseCount.mockResolvedValue(0);
        mockCouponReservationCount.mockResolvedValue(0);
        mockBookingUpdate.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'FREE100',
            appliedCouponId: couponId,
            appliedCouponPercent: 100,
            discountAmount: new Prisma.Decimal(450),
            netAmount: new Prisma.Decimal(0),
          }),
        );

        const service = new BookingCouponsService(prisma);
        const result = await service.applyCoupon(bookingId, studentUserId, { code: 'FREE100' });

        expect(result).toMatchObject({
          discountAmount: '450.00',
          netAmount: '0.00',
        });
      });

      it('rejects rounding-induced zero net amount for non-100% coupon with 409 PAYMENT_AMOUNT_UNSUPPORTED before write', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponFindUnique,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({ subtotalAmount: new Prisma.Decimal('0.50') }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(baseCouponRow({ percent: 99 }));

        const service = new BookingCouponsService(prisma);
        await expect(
          service.applyCoupon(bookingId, studentUserId, { code: 'WELCOME99' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_AMOUNT_UNSUPPORTED',
            message: 'PromptPay supports THB 20.00–150,000.00',
          }),
        );
        expect(mockBookingUpdate).not.toHaveBeenCalled();
      });

      it('throws 409 COUPON_EXHAUSTED when coupon maxUses is reached in apply', async () => {
        const { mockBookingFindUnique, mockCouponFindUnique, mockPaymentAttemptFindFirst, prisma } =
          createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(baseBookingRow());
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponFindUnique.mockResolvedValue(
          baseCouponRow({ maxUses: 10, _count: { reservations: 4, uses: 6 } }),
        );

        const service = new BookingCouponsService(prisma);
        await expect(
          service.applyCoupon(bookingId, studentUserId, { code: 'WELCOME10' }),
        ).rejects.toThrow(
          new ConflictException({
            code: 'COUPON_EXHAUSTED',
            message: 'Coupon usage limit reached',
          }),
        );
      });
    });

    describe('removeCoupon', () => {
      it('removes applied coupon and restores netAmount to subtotalAmount', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponReservationFindFirst,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'WELCOME10',
            appliedCouponId: couponId,
            appliedCouponPercent: 10,
            discountAmount: new Prisma.Decimal(45),
            netAmount: new Prisma.Decimal(405),
          }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);
        mockBookingUpdate.mockResolvedValue(baseBookingRow());

        const service = new BookingCouponsService(prisma);
        const result = await service.removeCoupon(bookingId, studentUserId);

        expect(mockBookingUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              appliedCouponCode: null,
              appliedCouponId: null,
              appliedCouponPercent: null,
              discountAmount: new Prisma.Decimal(0),
              netAmount: new Prisma.Decimal(450),
            },
            where: { id: bookingId },
          }),
        );
        expect(result).toMatchObject({
          bookingId,
          coupon: null,
          discountAmount: '0.00',
          netAmount: '450.00',
          paymentPending: false,
          paymentStatus: PaymentStatus.UNPAID,
          subtotalAmount: '450.00',
        });
      });

      it('returns 200 unchanged when coupon is already removed (idempotency)', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponReservationFindFirst,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        mockBookingFindUnique.mockResolvedValue(baseBookingRow({ appliedCouponId: null }));
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);

        const service = new BookingCouponsService(prisma);
        const result = await service.removeCoupon(bookingId, studentUserId);

        expect(mockBookingUpdate).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          coupon: null,
          discountAmount: '0.00',
          netAmount: '450.00',
        });
      });

      it('throws 409 PAYMENT_AMOUNT_UNSUPPORTED when restored subtotal amount is unsupported (0 < net < 20)', async () => {
        const {
          mockBookingFindUnique,
          mockBookingUpdate,
          mockCouponReservationFindFirst,
          mockPaymentAttemptFindFirst,
          prisma,
        } = createMockPrisma();

        // subtotal is 15.00
        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({
            appliedCouponCode: 'WELCOME10',
            appliedCouponId: couponId,
            appliedCouponPercent: 10,
            discountAmount: new Prisma.Decimal('1.50'),
            netAmount: new Prisma.Decimal('13.50'),
            subtotalAmount: new Prisma.Decimal(15),
          }),
        );
        mockPaymentAttemptFindFirst.mockResolvedValue(null);
        mockCouponReservationFindFirst.mockResolvedValue(null);

        const service = new BookingCouponsService(prisma);
        await expect(service.removeCoupon(bookingId, studentUserId)).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_AMOUNT_UNSUPPORTED',
            message: 'PromptPay supports THB 20.00–150,000.00',
          }),
        );

        expect(mockBookingUpdate).not.toHaveBeenCalled();
      });

      it('throws 409 PAYMENT_IN_PROGRESS when booking has active payment during remove', async () => {
        const { mockBookingFindUnique, prisma } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({
            appliedCouponId: couponId,
            paymentPending: true,
          }),
        );

        const service = new BookingCouponsService(prisma);
        await expect(service.removeCoupon(bookingId, studentUserId)).rejects.toThrow(
          new ConflictException({
            code: 'PAYMENT_IN_PROGRESS',
            message: 'A payment is currently in progress',
          }),
        );
      });

      it('throws 409 BOOKING_NOT_PAYABLE when booking is paid during remove', async () => {
        const { mockBookingFindUnique, prisma } = createMockPrisma();
        mockBookingFindUnique.mockResolvedValue(
          baseBookingRow({
            appliedCouponId: couponId,
            paymentStatus: PaymentStatus.PAID,
          }),
        );

        const service = new BookingCouponsService(prisma);
        await expect(service.removeCoupon(bookingId, studentUserId)).rejects.toThrow(
          new ConflictException({
            code: 'BOOKING_NOT_PAYABLE',
            message: 'Booking is not payable',
          }),
        );
      });
    });
  });
});

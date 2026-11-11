import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/client';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { RequireOwnership } from '@modules/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingCouponsService } from '@modules/bookings/booking-coupons.service';
import {
  BookingClassDetailDto,
  BookingCouponCodeDto,
  BookingCouponOperationResponseDto,
  BookingCouponQuoteResponseDto,
  BookingDetailResponseDto,
  BookingMeetingLinkDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  CancelBookingDto,
  CanceledBookingDto,
  ClassAttendanceResponseDto,
  ConfirmBookingDto,
  CreateBookingDto,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MyBookingsResponseDto,
  RejectBookingDto,
  TutorBookingActionResponseDto,
  TutorBookingsResponseDto,
  UpdateAttendanceDto,
  UpdateMeetingLinkDto,
} from '@modules/bookings/bookings.dto';
import {
  BOOKING_OWNERSHIP_ERRORS,
  CLASS_DETAIL_BOOKING_OWNERSHIP_ERRORS,
  CANCEL_BOOKING_OWNERSHIP_ERRORS,
  STUDENT_BOOKING_OWNERSHIP_ERRORS,
  BookingsService,
} from '@modules/bookings/bookings.service';
import {
  ApplyBookingCouponDoc,
  BookingsControllerDoc,
  CancelBookingDoc,
  ConfirmTutorBookingDoc,
  CreateBookingDoc,
  CreateMockPaymentDoc,
  GetBookingClassDetailDoc,
  GetBookingQuoteDoc,
  GetMyBookingDoc,
  GetMyBookingsDoc,
  GetTutorBookingsDoc,
  QuoteBookingCouponDoc,
  RejectTutorBookingDoc,
  RemoveBookingCouponDoc,
  UpdateAttendanceDoc,
  UpdateMeetingLinkDoc,
} from '@modules/bookings/bookings.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { OwnershipRule } from '@modules/auth/ownership.decorator';

function assertEmptyQuery(query: Record<string, unknown>): void {
  if (query !== undefined && Object.keys(query).length !== 0) {
    throw new BadRequestException('Unexpected query parameters');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The S2-T01 card answers a wrong tutor with 403 instead of the ownership-safe 404 the guard uses
 * elsewhere, so these two routes declare their own outcome bodies.
 */
const TUTOR_BOOKING_ACTION_OWNERSHIP = {
  errors: BOOKING_OWNERSHIP_ERRORS,
  idParam: 'bookingId',
  resource: 'booking',
} as const satisfies OwnershipRule;

/** The S2-T04 and S3-T25 cards answer a wrong student with 403, so these routes declare their own bodies too. */
const STUDENT_BOOKING_OWNERSHIP = {
  errors: STUDENT_BOOKING_OWNERSHIP_ERRORS,
  idParam: 'bookingId',
  resource: 'booking',
} as const satisfies OwnershipRule;
const STUDENT_BOOKING_PAYMENT_OWNERSHIP = STUDENT_BOOKING_OWNERSHIP;

/** The class-details endpoint answers authenticated non-participants with 403 rather than 404. */
const CLASS_DETAIL_BOOKING_OWNERSHIP = {
  errors: CLASS_DETAIL_BOOKING_OWNERSHIP_ERRORS,
  idParam: 'bookingId',
  resource: 'booking',
} as const satisfies OwnershipRule;
/** The cancellation card answers a non-participant with 403, so this route declares its own bodies. */
const CANCEL_BOOKING_OWNERSHIP = {
  errors: CANCEL_BOOKING_OWNERSHIP_ERRORS,
  idParam: 'bookingId',
  resource: 'booking',
} as const satisfies OwnershipRule;

@BookingsControllerDoc()
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly bookingCouponsService: BookingCouponsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @CreateBookingDoc()
  @Roles(Role.STUDENT)
  async create(
    @Body() dto: CreateBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BookingResponseDto> {
    return this.bookingsService.create({
      ...dto,
      studentUserId: user.id,
    });
  }

  @Get('quote')
  @HttpCode(HttpStatus.OK)
  @GetBookingQuoteDoc()
  @Roles(Role.STUDENT)
  async getQuote(
    @Query() query: GetBookingQuoteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BookingQuoteResponseDto> {
    return this.bookingsService.getQuote({
      ...query,
      studentUserId: user.id,
    });
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @GetMyBookingsDoc()
  @Roles(Role.STUDENT)
  async getMyBookings(
    @Query() query: GetMyBookingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyBookingsResponseDto> {
    return this.bookingsService.getMyBookings({
      ...query,
      studentUserId: user.id,
    });
  }

  @Get('me/:bookingId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @GetMyBookingDoc()
  @Roles(Role.STUDENT)
  @RequireOwnership(STUDENT_BOOKING_OWNERSHIP)
  async getMyBookingById(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown> = {},
  ): Promise<BookingDetailResponseDto> {
    assertEmptyQuery(query);
    return this.bookingsService.getMyBookingById({
      bookingId,
      studentUserId: user.id,
    });
  }

  @Post('me/:bookingId/coupon-quote')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @QuoteBookingCouponDoc()
  @Roles(Role.STUDENT)
  @RequireOwnership(STUDENT_BOOKING_OWNERSHIP)
  async getCouponQuote(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BookingCouponCodeDto,
    @Query() query: Record<string, unknown> = {},
  ): Promise<BookingCouponQuoteResponseDto> {
    assertEmptyQuery(query);
    return this.bookingCouponsService.quoteCoupon(bookingId, user.id, dto);
  }

  @Put('me/:bookingId/coupon')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApplyBookingCouponDoc()
  @Roles(Role.STUDENT)
  @RequireOwnership(STUDENT_BOOKING_OWNERSHIP)
  async applyCoupon(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BookingCouponCodeDto,
    @Query() query: Record<string, unknown> = {},
  ): Promise<BookingCouponOperationResponseDto> {
    assertEmptyQuery(query);
    return this.bookingCouponsService.applyCoupon(bookingId, user.id, dto);
  }

  @Delete('me/:bookingId/coupon')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @RemoveBookingCouponDoc()
  @Roles(Role.STUDENT)
  @RequireOwnership(STUDENT_BOOKING_OWNERSHIP)
  async removeCoupon(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown = undefined,
    @Query() query: Record<string, unknown> = {},
  ): Promise<BookingCouponOperationResponseDto> {
    if (body !== undefined && (!isRecord(body) || Object.keys(body).length !== 0)) {
      throw new BadRequestException('Coupon removal accepts an empty body only');
    }
    assertEmptyQuery(query);
    return this.bookingCouponsService.removeCoupon(bookingId, user.id);
  }

  @Post('me/:bookingId/mock-payment')
  @HttpCode(HttpStatus.OK)
  @CreateMockPaymentDoc()
  @Roles(Role.STUDENT)
  @RequireOwnership(STUDENT_BOOKING_PAYMENT_OWNERSHIP)
  createMockPayment(): never {
    throw new GoneException('Mock payment is retired. Use the PromptPay test payment endpoint.');
  }

  @Get('tutor')
  @HttpCode(HttpStatus.OK)
  @GetTutorBookingsDoc()
  @Roles(Role.TUTOR)
  async getTutorBookings(
    @Query() query: GetTutorBookingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TutorBookingsResponseDto> {
    return this.bookingsService.getTutorBookings({
      ...query,
      tutorUserId: user.id,
    });
  }

  @Post('tutor/:bookingId/confirm')
  @HttpCode(HttpStatus.OK)
  @ConfirmTutorBookingDoc()
  @Roles(Role.TUTOR)
  @RequireOwnership(TUTOR_BOOKING_ACTION_OWNERSHIP)
  async confirmTutorBooking(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @Body() dto: ConfirmBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TutorBookingActionResponseDto> {
    return this.bookingsService.confirmTutorBooking({
      ...dto,
      bookingId,
      tutorUserId: user.id,
    });
  }

  @Post('tutor/:bookingId/reject')
  @HttpCode(HttpStatus.OK)
  @RejectTutorBookingDoc()
  @Roles(Role.TUTOR)
  @RequireOwnership(TUTOR_BOOKING_ACTION_OWNERSHIP)
  async rejectTutorBooking(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @Body() dto: RejectBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TutorBookingActionResponseDto> {
    return this.bookingsService.rejectTutorBooking({
      ...dto,
      bookingId,
      tutorUserId: user.id,
    });
  }

  @Put('tutor/:bookingId/meeting-link')
  @HttpCode(HttpStatus.OK)
  @UpdateMeetingLinkDoc()
  @Roles(Role.TUTOR)
  @RequireOwnership(TUTOR_BOOKING_ACTION_OWNERSHIP)
  async updateMeetingLink(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @Body() dto: UpdateMeetingLinkDto,
  ): Promise<BookingMeetingLinkDto> {
    return this.bookingsService.updateMeetingLink({
      bookingId,
      meetingUrl: dto.meetingUrl,
    });
  }

  @Get(':bookingId/class-details')
  @HttpCode(HttpStatus.OK)
  @GetBookingClassDetailDoc()
  @RequireOwnership(CLASS_DETAIL_BOOKING_OWNERSHIP)
  async getBookingClassDetail(
    @Param('bookingId', UuidParamPipe) bookingId: string,
  ): Promise<BookingClassDetailDto> {
    return this.bookingsService.getBookingClassDetail(bookingId);
  }

  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @CancelBookingDoc()
  @RequireOwnership(CANCEL_BOOKING_OWNERSHIP)
  async cancelBooking(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CanceledBookingDto> {
    return this.bookingsService.cancelBooking({
      bookingId,
      reason: dto.reason,
      userId: user.id,
    });
  }

  @Put('tutor/:bookingId/attendance')
  @HttpCode(HttpStatus.OK)
  @UpdateAttendanceDoc()
  @Roles(Role.TUTOR)
  @RequireOwnership(TUTOR_BOOKING_ACTION_OWNERSHIP)
  async updateAttendance(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClassAttendanceResponseDto> {
    return this.bookingsService.updateAttendance({
      bookingId,
      tutorId: user.id,
      attendance: dto.attendance,
    });
  }
}

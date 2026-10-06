import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import {
  BookingDetailResponseDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  ConfirmBookingDto,
  CreateBookingDto,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MyBookingsResponseDto,
  RejectBookingDto,
  TutorBookingActionResponseDto,
  TutorBookingsResponseDto,
} from '@modules/bookings/bookings.dto';
import { BOOKING_OWNERSHIP_ERRORS, BookingsService } from '@modules/bookings/bookings.service';
import {
  BookingsControllerDoc,
  ConfirmTutorBookingDoc,
  CreateBookingDoc,
  GetBookingQuoteDoc,
  GetMyBookingDoc,
  GetMyBookingsDoc,
  GetTutorBookingsDoc,
  RejectTutorBookingDoc,
} from '@modules/bookings/bookings.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { OwnershipRule } from '@modules/auth/ownership.decorator';

/**
 * The S2-T01 card answers a wrong tutor with 403 instead of the ownership-safe 404 the guard uses
 * elsewhere, so these two routes declare their own outcome bodies.
 */
const TUTOR_BOOKING_ACTION_OWNERSHIP = {
  errors: BOOKING_OWNERSHIP_ERRORS,
  idParam: 'bookingId',
  resource: 'booking',
} as const satisfies OwnershipRule;

@BookingsControllerDoc()
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

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
  @GetMyBookingDoc()
  @Roles(Role.STUDENT)
  @RequireOwnership({ resource: 'booking', idParam: 'bookingId' })
  async getMyBookingById(
    @Param('bookingId') bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BookingDetailResponseDto> {
    return this.bookingsService.getMyBookingById({
      bookingId,
      studentUserId: user.id,
    });
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
}

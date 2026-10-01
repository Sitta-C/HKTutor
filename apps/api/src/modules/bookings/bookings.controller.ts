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
  CreateBookingDto,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MyBookingsResponseDto,
  TutorBookingsResponseDto,
} from '@modules/bookings/bookings.dto';
import { BookingsService } from '@modules/bookings/bookings.service';
import {
  BookingsControllerDoc,
  CreateBookingDoc,
  GetBookingQuoteDoc,
  GetMyBookingDoc,
  GetMyBookingsDoc,
  GetTutorBookingsDoc,
} from '@modules/bookings/bookings.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';

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
}

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/auth.decorator';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import {
  BookingQuoteResponseDto,
  BookingResponseDto,
  CreateBookingDto,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  MyBookingsResponseDto,
} from '@/bookings/bookings.dto';
import { BookingsService } from '@/bookings/bookings.service';
import {
  CreateBookingDoc,
  GetBookingQuoteDoc,
  GetMyBookingsDoc,
} from '@/bookings/bookings.swagger';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';

@ApiTags('bookings')
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
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
}

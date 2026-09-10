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
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@/auth/auth.decorator';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { RequireOwnership } from '@/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
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
} from '@/bookings/bookings.dto';
import { BookingsService } from '@/bookings/bookings.service';
import {
  CreateBookingDoc,
  GetBookingQuoteDoc,
  GetMyBookingDoc,
  GetMyBookingsDoc,
  GetTutorBookingsDoc,
} from '@/bookings/bookings.swagger';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';

@ApiTags('bookings')
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

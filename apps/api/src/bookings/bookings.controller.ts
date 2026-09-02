import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { BookingResponseDto, CreateBookingDto } from '@/bookings/bookings.dto';
import { BookingsService } from '@/bookings/bookings.service';
import { CreateBookingDoc } from '@/bookings/bookings.swagger';

@ApiTags('bookings')
@Controller('api/bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @CreateBookingDoc()
  async create(@Body() dto: CreateBookingDto): Promise<BookingResponseDto> {
    if (!dto.studentUserId) {
      throw new BadRequestException('studentUserId is required');
    }

    return this.bookingsService.create({
      ...dto,
      studentUserId: dto.studentUserId,
    });
  }
}

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/enums';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { RequireOwnership } from '@modules/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { CreateReviewDto } from '@modules/reviews/reviews.dto';
import { ReviewsService } from '@modules/reviews/reviews.service';
import {
  CreateReviewDoc,
  CreateReviewResponseDto,
  GetReviewDoc,
  GetReviewResponseDto,
} from '@modules/reviews/reviews.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { OwnershipRule } from '@modules/auth/ownership.decorator';

const BOOKING_REVIEW_OWNERSHIP = {
  errors: {
    foreignOwner: { code: 'BOOKING_NOT_OWNED', message: 'This booking belongs to another student' },
  },
  idParam: 'bookingId',
  resource: 'booking',
} as const satisfies OwnershipRule;

@Controller('bookings/me/:bookingId/reviews')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.STUDENT)
@RequireOwnership(BOOKING_REVIEW_OWNERSHIP)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @CreateReviewDoc()
  create(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReviewDto,
  ): Promise<CreateReviewResponseDto> {
    return this.reviews.create(bookingId, user.id, dto);
  }
}

@Controller('bookings/me/:bookingId/review')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.STUDENT)
@RequireOwnership(BOOKING_REVIEW_OWNERSHIP)
export class ReviewController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @GetReviewDoc()
  findMine(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GetReviewResponseDto> {
    return this.reviews.findMine(bookingId, user.id);
  }
}

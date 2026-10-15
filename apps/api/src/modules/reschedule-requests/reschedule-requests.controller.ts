import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { RequireOwnership } from '@modules/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  CreateRescheduleRequestDto,
  RejectRescheduleRequestDto,
} from '@modules/reschedule-requests/reschedule-requests.dto';
import {
  RESCHEDULE_BOOKING_OWNERSHIP_ERRORS,
  RescheduleRequestsService,
} from '@modules/reschedule-requests/reschedule-requests.service';
import {
  ApproveRescheduleRequestDoc,
  BookingRescheduleRequestsControllerDoc,
  CreateRescheduleRequestDoc,
  GetCurrentRescheduleRequestDoc,
  RejectRescheduleRequestDoc,
  RescheduleRequestsControllerDoc,
  WithdrawRescheduleRequestDoc,
} from '@modules/reschedule-requests/reschedule-requests.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { OwnershipRule } from '@modules/auth/ownership.decorator';
import type {
  ApproveRescheduleResponseDto,
  CreateRescheduleRequestResponseDto,
  CurrentRescheduleRequestResponseDto,
  RejectRescheduleResponseDto,
  WithdrawRescheduleResponseDto,
} from '@modules/reschedule-requests/reschedule-requests.dto';

const BOOKING_PARTICIPANT_OWNERSHIP = {
  errors: RESCHEDULE_BOOKING_OWNERSHIP_ERRORS,
  idParam: 'bookingId',
  resource: 'booking',
} as const satisfies OwnershipRule;

@BookingRescheduleRequestsControllerDoc()
@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
export class BookingRescheduleRequestsController {
  constructor(private readonly service: RescheduleRequestsService) {}

  @Post(':bookingId/reschedule-requests')
  @HttpCode(HttpStatus.CREATED)
  @CreateRescheduleRequestDoc()
  @RequireOwnership(BOOKING_PARTICIPANT_OWNERSHIP)
  async create(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @Body() dto: CreateRescheduleRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreateRescheduleRequestResponseDto> {
    return this.service.create(user.id, user.role, bookingId, dto);
  }

  @Get(':bookingId/reschedule-requests/current')
  @HttpCode(HttpStatus.OK)
  @GetCurrentRescheduleRequestDoc()
  @RequireOwnership(BOOKING_PARTICIPANT_OWNERSHIP)
  async getCurrent(
    @Param('bookingId', UuidParamPipe) bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CurrentRescheduleRequestResponseDto> {
    return this.service.getCurrent(user.id, bookingId);
  }
}

@RescheduleRequestsControllerDoc()
@Controller('reschedule-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RescheduleRequestsController {
  constructor(private readonly service: RescheduleRequestsService) {}

  @Post(':requestId/approve')
  @HttpCode(HttpStatus.OK)
  @ApproveRescheduleRequestDoc()
  async approve(
    @Param('requestId', UuidParamPipe) requestId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ApproveRescheduleResponseDto> {
    return this.service.approve(user.id, requestId);
  }

  @Post(':requestId/reject')
  @HttpCode(HttpStatus.OK)
  @RejectRescheduleRequestDoc()
  async reject(
    @Param('requestId', UuidParamPipe) requestId: string,
    @Body() dto: RejectRescheduleRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RejectRescheduleResponseDto> {
    return this.service.reject(user.id, requestId, dto);
  }

  @Post(':requestId/withdraw')
  @HttpCode(HttpStatus.OK)
  @WithdrawRescheduleRequestDoc()
  async withdraw(
    @Param('requestId', UuidParamPipe) requestId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WithdrawRescheduleResponseDto> {
    return this.service.withdraw(user.id, requestId);
  }
}

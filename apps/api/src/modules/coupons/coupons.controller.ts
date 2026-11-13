import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/enums';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  CreateCouponDto,
  ListCouponsQueryDto,
  SetCouponActivationDto,
} from '@modules/coupons/coupons.dto';
import { CouponsService } from '@modules/coupons/coupons.service';
import {
  CouponDto,
  CouponListDto,
  CouponsControllerDoc,
  CreateCouponDoc,
  ListCouponsDoc,
  SetCouponActivationDoc,
} from '@modules/coupons/coupons.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';

@CouponsControllerDoc()
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @CreateCouponDoc()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCouponDto): Promise<CouponDto> {
    return this.coupons.create(user.id, dto);
  }

  @Patch(':couponId/activation')
  @Header('Cache-Control', 'no-store')
  @SetCouponActivationDoc()
  setActivation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('couponId', UuidParamPipe) couponId: string,
    @Body() dto: SetCouponActivationDto,
  ): Promise<CouponDto> {
    return this.coupons.setActivation(user.id, couponId, dto.active);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ListCouponsDoc()
  list(@Query() query: ListCouponsQueryDto): Promise<CouponListDto> {
    return this.coupons.list(query);
  }
}

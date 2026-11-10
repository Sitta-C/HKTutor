import { Body, Controller, Get, Header, Post, Query, UseGuards } from '@nestjs/common';

import { Role } from '@generated/prisma/enums';
import { CurrentUser, RequireCurrentConsent } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { CreateCouponDto, ListCouponsQueryDto } from '@modules/coupons/coupons.dto';
import { CouponsService } from '@modules/coupons/coupons.service';
import {
  CouponDto,
  CouponListDto,
  CreateCouponDoc,
  ListCouponsDoc,
} from '@modules/coupons/coupons.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';

@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Post()
  @RequireCurrentConsent()
  @Header('Cache-Control', 'no-store')
  @CreateCouponDoc()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCouponDto): Promise<CouponDto> {
    return this.coupons.create(user.id, dto);
  }

  @Get()
  @RequireCurrentConsent()
  @Header('Cache-Control', 'no-store')
  @ListCouponsDoc()
  list(@Query() query: ListCouponsQueryDto): Promise<CouponListDto> {
    return this.coupons.list(query);
  }
}

import { Module } from '@nestjs/common';

import { CouponsController } from '@modules/coupons/coupons.controller';
import { CouponsService } from '@modules/coupons/coupons.service';

@Module({ controllers: [CouponsController], providers: [CouponsService] })
export class CouponsModule {}

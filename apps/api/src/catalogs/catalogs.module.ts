import { Module } from '@nestjs/common';

import { CatalogsController } from '@/catalogs/catalogs.controller';
import { CatalogsService } from '@/catalogs/catalogs.service';

@Module({
  controllers: [CatalogsController],
  providers: [CatalogsService],
})
export class CatalogsModule {}

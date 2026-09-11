import { Module } from '@nestjs/common';

import { CatalogController } from '@/tutors/catalog.controller';
import { PublicTutorsController } from '@/tutors/public-tutors.controller';
import { TutorsController } from '@/tutors/tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

@Module({
  controllers: [CatalogController, PublicTutorsController, TutorsController],
  providers: [TutorsService],
})
export class TutorsModule {}

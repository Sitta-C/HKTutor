import { Module } from '@nestjs/common';

import { CatalogController } from '@/tutors/catalog.controller';
import { PublicTutorsController } from '@/tutors/public-tutors.controller';
import { TutorsPrivateController, TutorsPublicController } from '@/tutors/tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

@Module({
  controllers: [CatalogController, PublicTutorsController, TutorsPrivateController, TutorsPublicController],
  providers: [TutorsService],
})
export class TutorsModule {}

import { Module } from '@nestjs/common';

import { CatalogController } from '@/tutors/catalog.controller';
import { TutorsPrivateController } from '@/tutors/tutors-private.controller';
import { TutorsPublicController } from '@/tutors/tutors-public.controller';
import { TutorsService } from '@/tutors/tutors.service';

@Module({
  controllers: [CatalogController, TutorsPrivateController, TutorsPublicController],
  providers: [TutorsService],
})
export class TutorsModule {}

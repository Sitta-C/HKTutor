import { Module } from '@nestjs/common';

import { CatalogController } from '@/tutors/catalog.controller';
import { TutorAvailabilityService } from '@/tutors/tutor-availability.service';
import { TutorDirectoryService } from '@/tutors/tutor-directory.service';
import { TutorListingsService } from '@/tutors/tutor-listings.service';
import { TutorsPrivateController } from '@/tutors/tutors-private.controller';
import { TutorsPublicController } from '@/tutors/tutors-public.controller';

@Module({
  controllers: [CatalogController, TutorsPrivateController, TutorsPublicController],
  providers: [TutorAvailabilityService, TutorDirectoryService, TutorListingsService],
})
export class TutorsModule {}

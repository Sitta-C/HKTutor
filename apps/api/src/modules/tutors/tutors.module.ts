import { Module } from '@nestjs/common';

import { CatalogController } from '@modules/tutors/catalog.controller';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorListingsService } from '@modules/tutors/tutor-listings.service';
import { TutorsPrivateController } from '@modules/tutors/tutors-private.controller';
import { TutorsPublicController } from '@modules/tutors/tutors-public.controller';

@Module({
  controllers: [CatalogController, TutorsPrivateController, TutorsPublicController],
  providers: [TutorAvailabilityService, TutorDirectoryService, TutorListingsService],
})
export class TutorsModule {}

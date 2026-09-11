import { Module } from '@nestjs/common';

import { TutorsPrivateController, TutorsPublicController } from '@/tutors/tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

@Module({
  controllers: [TutorsPrivateController, TutorsPublicController],
  providers: [TutorsService],
})
export class TutorsModule {}

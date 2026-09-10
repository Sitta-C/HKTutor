import { Module } from '@nestjs/common';

import { TutorsPrivateController } from '@/tutors/tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

@Module({
  controllers: [TutorsPrivateController],
  providers: [TutorsService],
})
export class TutorsModule {}

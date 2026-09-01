import { Module } from '@nestjs/common';

import { TutorsController } from '@/tutors/tutors.controller';
import { TutorsService } from '@/tutors/tutors.service';

@Module({
  controllers: [TutorsController],
  providers: [TutorsService],
})
export class TutorsModule {}

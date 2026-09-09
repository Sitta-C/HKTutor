import { Module } from '@nestjs/common';

import { TutorsService } from '@/tutors/tutors.service';
import { TutorsController } from '@/tutors/tutors.controller';

@Module({
    controllers: [TutorsController],
    providers: [TutorsService],
})
export class TutorsModule {}

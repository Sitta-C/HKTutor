import { Module } from '@nestjs/common';

import { ProfilesController } from '@/profiles/profiles.controller';
import { ProfilesService } from '@/profiles/profiles.service';

@Module({
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}

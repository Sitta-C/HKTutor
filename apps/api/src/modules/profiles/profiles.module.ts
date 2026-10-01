import { Module } from '@nestjs/common';

import { ProfilesController } from '@modules/profiles/profiles.controller';
import { ProfilesService } from '@modules/profiles/profiles.service';

@Module({
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}

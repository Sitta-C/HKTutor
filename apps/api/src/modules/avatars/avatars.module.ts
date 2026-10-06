import { Module } from '@nestjs/common';

import { StorageCleanupModule } from '@infrastructure/storage/storage-cleanup.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import {
  AvatarsController,
  PublicTutorAvatarsController,
} from '@modules/avatars/avatars.controller';
import { AvatarsService } from '@modules/avatars/avatars.service';

@Module({
  imports: [StorageModule, StorageCleanupModule],
  controllers: [AvatarsController, PublicTutorAvatarsController],
  providers: [AvatarsService],
})
export class AvatarsModule {}

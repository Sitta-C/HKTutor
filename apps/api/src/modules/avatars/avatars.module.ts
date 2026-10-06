import { Module } from '@nestjs/common';

import { StorageModule } from '@infrastructure/storage/storage.module';
import { AvatarRecoveryService } from '@modules/avatars/avatar-recovery.service';
import {
  AvatarsController,
  PublicTutorAvatarsController,
} from '@modules/avatars/avatars.controller';
import { AvatarsService } from '@modules/avatars/avatars.service';

@Module({
  imports: [StorageModule],
  controllers: [AvatarsController, PublicTutorAvatarsController],
  providers: [AvatarsService, AvatarRecoveryService],
})
export class AvatarsModule {}

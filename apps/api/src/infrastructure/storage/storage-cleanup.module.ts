import { Module } from '@nestjs/common';

import { DatabaseModule } from '@infrastructure/database/database.module';
import { StorageCleanupService } from '@infrastructure/storage/storage-cleanup.service';
import { StorageModule } from '@infrastructure/storage/storage.module';

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [StorageCleanupService],
  exports: [StorageCleanupService],
})
export class StorageCleanupModule {}

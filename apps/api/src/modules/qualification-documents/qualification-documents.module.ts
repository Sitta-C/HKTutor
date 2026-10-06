import { Module } from '@nestjs/common';

import { StorageCleanupModule } from '@infrastructure/storage/storage-cleanup.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import {
  AdminTutorVerificationsController,
  TutorQualificationDocumentsController,
} from '@modules/qualification-documents/qualification-documents.controller';
import { QualificationDocumentsService } from '@modules/qualification-documents/qualification-documents.service';

@Module({
  imports: [StorageModule, StorageCleanupModule],
  controllers: [TutorQualificationDocumentsController, AdminTutorVerificationsController],
  providers: [QualificationDocumentsService],
})
export class QualificationDocumentsModule {}

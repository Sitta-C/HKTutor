import { Module } from '@nestjs/common';

import { StorageModule } from '@infrastructure/storage/storage.module';
import {
  AdminTutorVerificationsController,
  TutorQualificationDocumentsController,
} from '@modules/qualification-documents/qualification-documents.controller';
import { QualificationDocumentsService } from '@modules/qualification-documents/qualification-documents.service';
import { QualificationUploadRecoveryService } from '@modules/qualification-documents/qualification-upload-recovery.service';

@Module({
  imports: [StorageModule],
  controllers: [TutorQualificationDocumentsController, AdminTutorVerificationsController],
  providers: [QualificationDocumentsService, QualificationUploadRecoveryService],
})
export class QualificationDocumentsModule {}

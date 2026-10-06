import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { DOCUMENT_MAX_SIZE_BYTES } from '@infrastructure/storage/storage.types';

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

@Injectable()
export class QualificationUploadInterceptor
  extends FileInterceptor('file', {
    // Multer rejects at its limit; the service enforces the inclusive 5 MiB boundary.
    limits: { fileSize: DOCUMENT_MAX_SIZE_BYTES + 1, files: 1, fields: 1, fieldSize: 1024 },
  })
  implements NestInterceptor
{
  override async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        // S2-T07's upload contract uses 400 for an oversized multipart file.
        throw new BadRequestException('Document must not exceed 5 MiB');
      }
      throw error;
    }
  }
}

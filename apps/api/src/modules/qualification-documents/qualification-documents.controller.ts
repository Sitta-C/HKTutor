import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/enums';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { RequireOwnership } from '@modules/auth/ownership.decorator';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  QualificationListQueryDto,
  QualificationQueueQueryDto,
  ReviewQualificationDto,
  UploadQualificationDto,
} from '@modules/qualification-documents/qualification-documents.dto';
import { DOCUMENT_OWNERSHIP_ERRORS } from '@modules/qualification-documents/qualification-documents.model';
import { QualificationDocumentsService } from '@modules/qualification-documents/qualification-documents.service';
import {
  ListQualificationsDoc,
  QualificationControllerDoc,
  QualificationDetailDoc,
  QualificationQueueDoc,
  QualificationSignedUrlDoc,
  ReviewQualificationDoc,
  UploadQualificationDoc,
} from '@modules/qualification-documents/qualification-documents.swagger';
import { QualificationUploadInterceptor } from '@modules/qualification-documents/qualification-upload.interceptor';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type {
  QualificationDetailResponseDto,
  QualificationListResponseDto,
  QualificationQueueResponseDto,
  QualificationReviewResponseDto,
  QualificationSignedUrlResponseDto,
  QualificationUploadResponseDto,
} from '@modules/qualification-documents/qualification-documents.swagger';
import type {} from 'multer';

@QualificationControllerDoc()
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.TUTOR)
@Controller('tutors/me/qualification-documents')
export class TutorQualificationDocumentsController {
  constructor(private readonly documents: QualificationDocumentsService) {}

  @Post()
  @UploadQualificationDoc()
  @UseInterceptors(QualificationUploadInterceptor)
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadQualificationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<QualificationUploadResponseDto> {
    return this.documents.upload(user, dto, file);
  }

  @Get()
  @ListQualificationsDoc()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QualificationListQueryDto,
  ): Promise<QualificationListResponseDto> {
    return this.documents.listMine(user, query);
  }

  @Get(':documentId/signed-url')
  @Header('Cache-Control', 'no-store')
  @RequireOwnership({
    resource: 'tutorDocument',
    idParam: 'documentId',
    errors: DOCUMENT_OWNERSHIP_ERRORS,
  })
  @QualificationSignedUrlDoc()
  signedUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', UuidParamPipe) documentId: string,
  ): Promise<QualificationSignedUrlResponseDto> {
    return this.documents.signedUrl(user, documentId, 'tutor');
  }
}

@QualificationControllerDoc()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/tutor-verifications')
export class AdminTutorVerificationsController {
  constructor(private readonly documents: QualificationDocumentsService) {}

  @Get()
  @QualificationQueueDoc()
  queue(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QualificationQueueQueryDto,
  ): Promise<QualificationQueueResponseDto> {
    return this.documents.queue(user, query);
  }

  @Get(':documentId')
  @QualificationDetailDoc()
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', UuidParamPipe) documentId: string,
  ): Promise<QualificationDetailResponseDto> {
    return this.documents.detail(user, documentId);
  }

  @Get(':documentId/signed-url')
  @Header('Cache-Control', 'no-store')
  @QualificationSignedUrlDoc()
  signedUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', UuidParamPipe) documentId: string,
  ): Promise<QualificationSignedUrlResponseDto> {
    return this.documents.signedUrl(user, documentId, 'admin');
  }

  @Patch(':documentId')
  @ReviewQualificationDoc()
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId', UuidParamPipe) documentId: string,
    @Body() dto: ReviewQualificationDto,
  ): Promise<QualificationReviewResponseDto> {
    return this.documents.review(user, documentId, dto);
  }
}

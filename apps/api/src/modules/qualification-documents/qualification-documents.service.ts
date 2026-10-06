import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import {
  Role,
  StorageObjectPurpose,
  TutorDocumentAuditAction,
  TutorDocumentReviewStatus,
  TutorVerificationStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  STORAGE_CLEANUP_GRACE_MS,
  StorageCleanupService,
} from '@infrastructure/storage/storage-cleanup.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import {
  DOCUMENT_MAX_SIZE_BYTES,
  SIGNED_URL_MAX_TTL_SECONDS,
} from '@infrastructure/storage/storage.types';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import {
  QualificationDecision,
  QualificationDocumentType,
  QualificationStatus,
} from '@modules/qualification-documents/qualification-documents.dto';
import {
  ACTIVE_TUTOR_WHERE,
  decodeQualificationCursor,
  DOCUMENT_OWNERSHIP_ERRORS,
  DOCUMENT_SELECT,
  encodeQualificationCursor,
  toDocumentResponse,
  toListItemResponse,
  toQualificationStatus,
  toReviewStatus,
} from '@modules/qualification-documents/qualification-documents.model';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type {
  QualificationListQueryDto,
  QualificationQueueQueryDto,
  ReviewQualificationDto,
  UploadQualificationDto,
} from '@modules/qualification-documents/qualification-documents.dto';
import type { DocumentMetadata } from '@modules/qualification-documents/qualification-documents.model';
import type {
  QualificationDetailResponseDto,
  QualificationListResponseDto,
  QualificationQueueResponseDto,
  QualificationReviewResponseDto,
  QualificationSignedUrlResponseDto,
  QualificationUploadResponseDto,
} from '@modules/qualification-documents/qualification-documents.swagger';
import type {} from 'multer';

@Injectable()
export class QualificationDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cleanup: StorageCleanupService,
  ) {}

  async upload(
    user: AuthenticatedUser,
    dto: UploadQualificationDto,
    file: Express.Multer.File | undefined,
  ): Promise<QualificationUploadResponseDto> {
    await this.assertTutor(user);
    if (!file || !file.buffer.length) {
      throw new BadRequestException('A non-empty document file is required');
    }
    if (file.buffer.length > DOCUMENT_MAX_SIZE_BYTES) {
      throw new BadRequestException('Document must not exceed 5 MiB');
    }
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)) {
      throw new BadRequestException('Document must be a PDF, JPEG, or PNG file');
    }
    if (!Object.values(QualificationDocumentType).includes(dto.documentType)) {
      throw new BadRequestException('Unsupported document type');
    }
    const originalName = file.originalname.trim();
    if (!originalName || originalName.length > 255 || /[/\\]|\p{Cc}/u.test(originalName)) {
      throw new BadRequestException('Invalid document filename');
    }
    if (
      await this.prisma.tutorDocument.findFirst({
        where: {
          tutorUserId: user.id,
          documentType: dto.documentType,
          reviewStatus: TutorDocumentReviewStatus.PENDING,
        },
        select: { id: true },
      })
    ) {
      throw pendingConflict();
    }
    const uploaded = this.storage.prepareDocument(user.id, {
      buffer: file.buffer,
      mimeType: file.mimetype,
    });
    // Persist before Storage I/O so a timeout or process crash still leaves a recovery task.
    await this.prisma.storageCleanupIntent.create({
      data: {
        purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
        objectPath: uploaded.objectPath,
        nextAttemptAt: new Date(Date.now() + STORAGE_CLEANUP_GRACE_MS),
      },
    });
    try {
      await this.storage.uploadPrepared(uploaded);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new BadRequestException('Document must not exceed 5 MiB');
      }
      throw error;
    }
    let document: DocumentMetadata;
    try {
      document = await this.prisma.$transaction(async (tx) => {
        await this.lockTutor(tx, user.id);
        await this.assertTutor(user, tx);
        const intents = await tx.$queryRaw<Array<{ objectPath: string }>>`
          SELECT "objectPath" FROM "StorageCleanupIntent"
          WHERE "purpose" = ${StorageObjectPurpose.QUALIFICATION_DOCUMENT}::"StorageObjectPurpose"
            AND "objectPath" = ${uploaded.objectPath} FOR UPDATE`;
        if (!intents.length) {
          throw new ServiceUnavailableException(
            'Document upload expired before metadata was saved',
          );
        }
        const created = await tx.tutorDocument.create({
          data: {
            tutorUserId: user.id,
            documentType: dto.documentType,
            objectPath: uploaded.objectPath,
            originalName,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
          },
          select: DOCUMENT_SELECT,
        });
        await tx.tutorDocumentAudit.create({
          data: {
            documentId: created.id,
            actorUserId: user.id,
            action: TutorDocumentAuditAction.UPLOADED,
          },
        });
        await this.updateTutorVerification(tx, user.id);
        await tx.storageCleanupIntent.delete({
          where: {
            purpose_objectPath: {
              purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
              objectPath: uploaded.objectPath,
            },
          },
        });
        return created;
      });
    } catch (error) {
      try {
        await this.cleanup.cleanup({
          purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
          objectPath: uploaded.objectPath,
        });
      } catch {
        throw new ServiceUnavailableException(
          'Document metadata could not be saved; cleanup will retry',
        );
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw pendingConflict();
      }
      if (
        error instanceof BadRequestException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException('Document metadata could not be saved');
    }
    return {
      documentId: document.id,
      status: QualificationStatus.PENDING,
      fileName: document.originalName,
      mimeType: document.mimeType,
      size: document.sizeBytes,
      createdAt: document.createdAt.toISOString(),
    };
  }

  async listMine(
    user: AuthenticatedUser,
    query: QualificationListQueryDto,
  ): Promise<QualificationListResponseDto> {
    await this.assertTutor(user);
    const documents = await this.prisma.tutorDocument.findMany({
      where: {
        tutorUserId: user.id,
        tutor: ACTIVE_TUTOR_WHERE,
        ...(query.status ? { reviewStatus: toReviewStatus(query.status) } : {}),
      },
      select: DOCUMENT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return { items: documents.map(toListItemResponse) };
  }

  async queue(
    user: AuthenticatedUser,
    query: QualificationQueueQueryDto,
  ): Promise<QualificationQueueResponseDto> {
    this.assertRole(user, Role.ADMIN);
    const status = query.status ?? QualificationStatus.PENDING;
    const limit = query.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('Queue limit must be between 1 and 100');
    }
    const cursor = query.cursor ? decodeQualificationCursor(query.cursor, status) : undefined;
    const documents = await this.prisma.tutorDocument.findMany({
      where: {
        tutor: ACTIVE_TUTOR_WHERE,
        reviewStatus: toReviewStatus(status),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        ...DOCUMENT_SELECT,
        tutor: { select: { userId: true, displayName: true, verificationStatus: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = documents.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((document) => ({ ...toDocumentResponse(document), tutor: document.tutor })),
      nextCursor: documents.length > limit && last ? encodeQualificationCursor(last, status) : null,
    };
  }

  async detail(
    user: AuthenticatedUser,
    documentId: string,
  ): Promise<QualificationDetailResponseDto> {
    this.assertRole(user, Role.ADMIN);
    const document = await this.prisma.tutorDocument.findFirst({
      where: { id: documentId, tutor: ACTIVE_TUTOR_WHERE },
      select: {
        ...DOCUMENT_SELECT,
        tutor: { select: { userId: true, displayName: true, verificationStatus: true } },
        auditEvents: {
          where: { action: TutorDocumentAuditAction.REVIEWED },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { actorUserId: true, createdAt: true, decision: true, reason: true },
        },
      },
    });
    if (!document) {
      throw documentNotFound();
    }
    const reviewHistory = document.auditEvents.flatMap((event) =>
      event.decision
        ? [
            {
              status: toQualificationStatus(event.decision),
              reviewedBy: event.actorUserId,
              reviewedAt: event.createdAt.toISOString(),
              reason: event.reason,
            },
          ]
        : [],
    );
    // Existing completed reviews predate the audit table; their immutable fields remain evidence.
    if (!reviewHistory.length && document.reviewedAt && document.reviewerUserId) {
      reviewHistory.push({
        status: toQualificationStatus(document.reviewStatus),
        reviewedBy: document.reviewerUserId,
        reviewedAt: document.reviewedAt.toISOString(),
        reason: document.rejectionReason,
      });
    }
    return { document: toDocumentResponse(document), tutor: document.tutor, reviewHistory };
  }

  async signedUrl(
    user: AuthenticatedUser,
    documentId: string,
    audience: 'tutor' | 'admin',
  ): Promise<QualificationSignedUrlResponseDto> {
    if (audience === 'tutor') {
      await this.assertTutor(user);
    } else {
      this.assertRole(user, Role.ADMIN);
    }
    const document = await this.prisma.tutorDocument.findFirst({
      where: { id: documentId, tutor: ACTIVE_TUTOR_WHERE },
      select: { tutorUserId: true, objectPath: true },
    });
    if (!document) {
      throw documentNotFound();
    }
    if (audience === 'tutor' && document.tutorUserId !== user.id) {
      throw documentNotOwned();
    }
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + SIGNED_URL_MAX_TTL_SECONDS * 1000);
    const url = await this.storage.createSignedUrl(
      'document',
      document.objectPath,
      SIGNED_URL_MAX_TTL_SECONDS,
    );
    try {
      await this.prisma.tutorDocumentAudit.create({
        data: {
          documentId,
          actorUserId: user.id,
          action: TutorDocumentAuditAction.SIGNED_URL_ISSUED,
          createdAt: issuedAt,
          expiresAt,
        },
      });
    } catch {
      throw new ServiceUnavailableException('Document access could not be audited');
    }
    return { url, expiresAt: expiresAt.toISOString() };
  }

  async review(
    user: AuthenticatedUser,
    documentId: string,
    dto: ReviewQualificationDto,
  ): Promise<QualificationReviewResponseDto> {
    this.assertRole(user, Role.ADMIN);
    if (!Object.values(QualificationDecision).includes(dto.decision)) {
      throw new BadRequestException('Invalid review decision');
    }
    const reason = dto.reason?.trim();
    if (
      (dto.decision === QualificationDecision.REJECTED && !reason) ||
      (dto.reason !== undefined && (!reason || Array.from(reason).length > 500))
    ) {
      throw new BadRequestException('Review reason must contain 1 to 500 characters');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const document = await tx.tutorDocument.findFirst({
          where: { id: documentId, tutor: ACTIVE_TUTOR_WHERE },
          select: { tutorUserId: true },
        });
        if (!document) {
          throw documentNotFound();
        }
        // Serialize uploads and reviews so aggregation includes the latest committed evidence.
        await this.lockTutor(tx, document.tutorUserId);
        const reviewedAt = new Date();
        const approved = dto.decision === QualificationDecision.APPROVED;
        const reviewStatus = approved
          ? TutorDocumentReviewStatus.VERIFIED
          : TutorDocumentReviewStatus.REJECTED;
        const updated = await tx.tutorDocument.updateMany({
          where: {
            id: documentId,
            reviewStatus: TutorDocumentReviewStatus.PENDING,
            tutor: ACTIVE_TUTOR_WHERE,
          },
          data: {
            reviewStatus,
            reviewerUserId: user.id,
            reviewedAt,
            rejectionReason: approved ? null : (reason ?? null),
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({
            code: 'DOCUMENT_ALREADY_REVIEWED',
            message: 'Qualification document has already been reviewed',
            error: 'Conflict',
            statusCode: 409,
          });
        }
        const tutorVerificationStatus = await this.updateTutorVerification(
          tx,
          document.tutorUserId,
        );
        await tx.tutorDocumentAudit.create({
          data: {
            documentId,
            actorUserId: user.id,
            action: TutorDocumentAuditAction.REVIEWED,
            decision: reviewStatus,
            reason: reason ?? null,
            createdAt: reviewedAt,
          },
        });
        return {
          documentId,
          status: approved ? QualificationStatus.APPROVED : QualificationStatus.REJECTED,
          reviewedAt: reviewedAt.toISOString(),
          reviewedBy: user.id,
          tutorVerificationStatus,
        };
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      throw new ServiceUnavailableException('Qualification review could not be saved');
    }
  }

  private assertRole(user: AuthenticatedUser, role: Role): void {
    if (user.role !== role) {
      throw new ForbiddenException('You do not have permission to access qualification documents');
    }
  }

  private async updateTutorVerification(
    tx: Prisma.TransactionClient,
    tutorUserId: string,
  ): Promise<TutorVerificationStatus> {
    const documents = await tx.tutorDocument.findMany({
      where: { tutorUserId },
      select: { reviewStatus: true },
    });
    const verificationStatus = documents.some(
      (doc) => doc.reviewStatus === TutorDocumentReviewStatus.VERIFIED,
    )
      ? TutorVerificationStatus.VERIFIED
      : documents.some((doc) => doc.reviewStatus === TutorDocumentReviewStatus.PENDING)
        ? TutorVerificationStatus.PENDING
        : TutorVerificationStatus.REJECTED;
    await tx.tutorProfile.update({
      where: { userId: tutorUserId },
      data: { verificationStatus },
      select: { userId: true },
    });
    return verificationStatus;
  }

  private async assertTutor(
    user: AuthenticatedUser,
    client: Pick<Prisma.TransactionClient, 'user'> = this.prisma,
  ): Promise<void> {
    this.assertRole(user, Role.TUTOR);
    const account = await client.user.findFirst({
      where: { id: user.id, role: Role.TUTOR, deletedAt: null, accountStatus: 'ACTIVE' },
      select: { policyVersion: true, tutorProfile: { select: { userId: true } } },
    });
    if (!account?.tutorProfile) {
      throw new NotFoundException('Tutor profile not found');
    }
    if (account.policyVersion !== CURRENT_PRIVACY_POLICY_VERSION) {
      throw new BadRequestException(
        'Accept the current privacy notice before accessing qualification documents',
      );
    }
  }

  private async lockTutor(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const rows = await tx.$queryRaw<
      Array<{
        userId: string;
      }>
    >`SELECT "userId" FROM "TutorProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    if (!rows.length) {
      throw new NotFoundException('Tutor profile not found');
    }
  }
}

function pendingConflict(): ConflictException {
  return new ConflictException({
    code: 'DOCUMENT_PENDING_DUPLICATE',
    message: 'A document of this type is already pending review',
    error: 'Conflict',
    statusCode: 409,
  });
}

function documentNotFound(): NotFoundException {
  return new NotFoundException({
    ...DOCUMENT_OWNERSHIP_ERRORS.missing,
    error: 'Not Found',
    statusCode: 404,
  });
}

function documentNotOwned(): ForbiddenException {
  return new ForbiddenException({
    ...DOCUMENT_OWNERSHIP_ERRORS.foreignOwner,
    error: 'Forbidden',
    statusCode: 403,
  });
}

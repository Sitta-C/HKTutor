import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { TutorVerificationStatus } from '@generated/prisma/enums';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import {
  QualificationDocumentType,
  QualificationStatus,
} from '@modules/qualification-documents/qualification-documents.dto';

export class QualificationUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  documentId!: string;
  @ApiProperty({ enum: QualificationStatus })
  status!: QualificationStatus;
  @ApiProperty({ example: 'degree.pdf' })
  fileName!: string;
  @ApiProperty({ enum: ['application/pdf', 'image/jpeg', 'image/png'] })
  mimeType!: string;
  @ApiProperty({ minimum: 1, maximum: 5242880, type: Number })
  size!: number;
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class QualificationDocumentResponseDto extends QualificationUploadResponseDto {
  @ApiProperty({ example: 'DEGREE', description: 'Document category; legacy values are preserved' })
  type!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  reviewedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rejectionReason!: string | null;
}

export class QualificationListItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  documentId!: string;
  @ApiProperty({ example: 'DEGREE' })
  type!: string;
  @ApiProperty({ enum: QualificationStatus })
  status!: QualificationStatus;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  reviewedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rejectionReason!: string | null;
}

export class QualificationListResponseDto {
  @ApiProperty({ type: [QualificationListItemResponseDto] })
  items!: QualificationListItemResponseDto[];
}

export class QualificationTutorResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;
  @ApiProperty()
  displayName!: string;
  @ApiProperty({ enum: TutorVerificationStatus })
  verificationStatus!: TutorVerificationStatus;
}

export class QualificationQueueItemResponseDto extends QualificationDocumentResponseDto {
  @ApiProperty({ type: QualificationTutorResponseDto })
  tutor!: QualificationTutorResponseDto;
}

export class QualificationQueueResponseDto {
  @ApiProperty({ type: [QualificationQueueItemResponseDto] })
  items!: QualificationQueueItemResponseDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class QualificationReviewHistoryDto {
  @ApiProperty({ enum: QualificationStatus })
  status!: QualificationStatus;
  @ApiProperty({ format: 'uuid' })
  reviewedBy!: string;
  @ApiProperty({ format: 'date-time' })
  reviewedAt!: string;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
}

export class QualificationDetailResponseDto {
  @ApiProperty({ type: QualificationDocumentResponseDto })
  document!: QualificationDocumentResponseDto;
  @ApiProperty({ type: QualificationTutorResponseDto })
  tutor!: QualificationTutorResponseDto;
  @ApiProperty({ type: [QualificationReviewHistoryDto] })
  reviewHistory!: QualificationReviewHistoryDto[];
}

export class QualificationSignedUrlResponseDto {
  @ApiProperty({ description: 'Transient private download URL; do not persist or log it' })
  url!: string;
  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class QualificationReviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  documentId!: string;
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  status!: QualificationStatus;
  @ApiProperty({ format: 'date-time' })
  reviewedAt!: string;
  @ApiProperty({ format: 'uuid' })
  reviewedBy!: string;
  @ApiProperty({ enum: TutorVerificationStatus })
  tutorVerificationStatus!: TutorVerificationStatus;
}

class QualificationErrorDto {
  @ApiProperty()
  statusCode!: number;
  @ApiProperty()
  error!: string;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] })
  message!: string | string[];
  @ApiProperty()
  code!: string;
  @ApiPropertyOptional()
  details?: string;
}

export function QualificationControllerDoc(): ClassDecorator {
  return applyDecorators(ApiTags('qualification-documents'), ApiBearerAuth(JWT_BEARER_AUTH));
}

export function UploadQualificationDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Upload an owner-only private qualification document',
      description:
        'PDF/JPEG/PNG, 0 < bytes <= 5242880. One pending document per tutor and documentType. APPROVED is mapped to database VERIFIED.',
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'documentType'],
        properties: {
          file: { type: 'string', format: 'binary' },
          documentType: { type: 'string', enum: Object.values(QualificationDocumentType) },
        },
      },
    }),
    ApiCreatedResponse({ type: QualificationUploadResponseDto }),
    ...errors(true, true),
    ApiServiceUnavailableResponse({ type: QualificationErrorDto }),
  );
}

export function ListQualificationsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'List the tutor’s own qualification metadata',
      description: 'Optional status filter; never includes objectPath or signed URLs.',
    }),
    ApiOkResponse({ type: QualificationListResponseDto }),
    ...errors(true, false),
  );
}

export function QualificationQueueDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'List the admin qualification review queue',
      description:
        'Defaults to PENDING and limit 20. Stable descending createdAt/id cursor order; cursor is bound to its status filter.',
    }),
    ApiOkResponse({ type: QualificationQueueResponseDto }),
    ...errors(false, false),
  );
}

export function QualificationDetailDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({ summary: 'Get admin qualification review details' }),
    ApiOkResponse({ type: QualificationDetailResponseDto }),
    ...errors(true, false),
  );
}

export function QualificationSignedUrlDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Issue an authorized and audited private qualification URL',
      description:
        'Valid for at most five minutes. Response uses Cache-Control: no-store. Auditing must succeed before the URL is returned.',
    }),
    ApiOkResponse({ type: QualificationSignedUrlResponseDto }),
    ...errors(true, false),
    ApiServiceUnavailableResponse({
      type: QualificationErrorDto,
      description: 'Private storage or access auditing failed',
    }),
  );
}

export function ReviewQualificationDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Review a pending qualification document once',
      description:
        'ADMIN only. Document, tutor status and audit update atomically. Tutor is VERIFIED if any document is approved, otherwise PENDING if any is pending, otherwise REJECTED.',
    }),
    ApiOkResponse({ type: QualificationReviewResponseDto }),
    ...errors(true, true),
    ApiServiceUnavailableResponse({ type: QualificationErrorDto }),
  );
}

function errors(missing: boolean, conflict: boolean): MethodDecorator[] {
  return [
    ApiBadRequestResponse({
      type: QualificationErrorDto,
      description:
        'Invalid input, cursor or UUID; upload empty/unsupported/oversized; rejected review without a bounded reason; missing current tutor privacy consent',
    }),
    ApiUnauthorizedResponse({ type: QualificationErrorDto }),
    ApiForbiddenResponse({
      type: QualificationErrorDto,
      description: 'Wrong role or another tutor’s document',
    }),
    ...(missing ? [ApiNotFoundResponse({ type: QualificationErrorDto })] : []),
    ...(conflict
      ? [
          ApiConflictResponse({
            type: QualificationErrorDto,
            description: 'Duplicate pending document or document already reviewed',
          }),
        ]
      : []),
  ];
}

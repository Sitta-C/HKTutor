import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export enum QualificationDocumentType {
  DEGREE = 'DEGREE',
  CERTIFICATE = 'CERTIFICATE',
}

export enum QualificationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum QualificationDecision {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export class UploadQualificationDto {
  @ApiProperty({ enum: QualificationDocumentType })
  @IsEnum(QualificationDocumentType)
  documentType!: QualificationDocumentType;
}

export class QualificationListQueryDto {
  @ApiPropertyOptional({ enum: QualificationStatus })
  @IsOptional()
  @IsEnum(QualificationStatus)
  status?: QualificationStatus;
}

export class QualificationQueueQueryDto extends QualificationListQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  cursor?: string;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ReviewQualificationDto {
  @ApiProperty({ enum: QualificationDecision })
  @IsEnum(QualificationDecision)
  decision!: QualificationDecision;
  @ApiPropertyOptional({
    description: 'Required for rejection; optional approval note',
    maxLength: 500,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(
    (dto: ReviewQualificationDto) =>
      dto.decision === QualificationDecision.REJECTED || dto.reason !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}

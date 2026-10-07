import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { Role } from '@generated/prisma/enums';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const MESSAGE_TEXT_MAX_LENGTH = 2000;

// Counts Unicode code points, as PostgreSQL's CHAR_LENGTH does in Message_text_check.
// @MaxLength counts some emoji differently, so a text could pass here and fail in the database.
const MESSAGE_TEXT_MAX_LENGTH_PATTERN = new RegExp(`^[\\s\\S]{0,${MESSAGE_TEXT_MAX_LENGTH}}$`, 'u');

export const DEFAULT_CONVERSATIONS_PAGE = 1;
export const DEFAULT_CONVERSATIONS_PAGE_SIZE = 20;
export const MAX_CONVERSATIONS_PAGE_SIZE = 100;

// The caller's role decides which key is required, so the service checks that, not this DTO.
export class CreateConversationDto {
  @ApiPropertyOptional({
    description: "Sent by a student: the tutor's user ID",
    example: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc',
  })
  @IsOptional()
  @IsUUID()
  tutorId?: string;

  @ApiPropertyOptional({
    description: "Sent by a tutor: the student's user ID",
    example: '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f',
  })
  @IsOptional()
  @IsUUID()
  participantId?: string;
}

export class SendMessageDto {
  @ApiProperty({
    description: 'Trimmed before validation',
    example: 'Do you teach quadratic equations?',
    maxLength: MESSAGE_TEXT_MAX_LENGTH,
    minLength: 1,
  })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @Matches(MESSAGE_TEXT_MAX_LENGTH_PATTERN, {
    message: `text must be at most ${MESSAGE_TEXT_MAX_LENGTH} characters`,
  })
  text!: string;
}

export class GetMyConversationsQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_CONVERSATIONS_PAGE, example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: DEFAULT_CONVERSATIONS_PAGE_SIZE,
    example: DEFAULT_CONVERSATIONS_PAGE_SIZE,
    maximum: MAX_CONVERSATIONS_PAGE_SIZE,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_CONVERSATIONS_PAGE_SIZE)
  pageSize?: number;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69' })
  messageId!: string;

  @ApiProperty({ example: '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f' })
  conversationId!: string;

  @ApiProperty({ example: '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f' })
  senderId!: string;

  @ApiProperty({ example: 'Do you teach quadratic equations?' })
  text!: string;

  @ApiProperty({ example: '2026-09-30T08:05:00.000Z' })
  sentAt!: string;

  @ApiProperty({
    description: 'Null until the other participant reads the message',
    example: null,
    nullable: true,
    type: String,
  })
  readAt!: string | null;
}

export class ConversationParticipantDto {
  @ApiProperty({ example: '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f' })
  userId!: string;

  @ApiProperty({ enum: [Role.STUDENT, Role.TUTOR], example: Role.STUDENT })
  role!: Role;
}

export class OpenConversationResponseDto {
  @ApiProperty({ example: '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f' })
  conversationId!: string;

  @ApiProperty({ description: 'The student, then the tutor', type: [ConversationParticipantDto] })
  participants!: ConversationParticipantDto[];

  @ApiProperty({ example: '2026-09-30T08:00:00.000Z' })
  createdAt!: string;
}

export class OtherParticipantDto {
  @ApiProperty({ example: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc' })
  userId!: string;

  @ApiProperty({
    description: "The tutor's display name or the student's nickname",
    example: 'Anan Suksawat',
  })
  displayName!: string;
}

export class ConversationLastMessageDto {
  @ApiProperty({ example: 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69' })
  messageId!: string;

  @ApiProperty({ example: '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f' })
  senderId!: string;

  @ApiProperty({ example: 'Do you teach quadratic equations?' })
  text!: string;

  @ApiProperty({ example: '2026-09-30T08:05:00.000Z' })
  sentAt!: string;
}

export class ConversationSummaryDto {
  @ApiProperty({ example: '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f' })
  conversationId!: string;

  @ApiProperty({ example: '2026-09-30T08:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: OtherParticipantDto })
  otherParticipant!: OtherParticipantDto;

  @ApiProperty({ nullable: true, type: ConversationLastMessageDto })
  lastMessage!: ConversationLastMessageDto | null;
}

export class MyConversationsResponseDto {
  @ApiProperty({ type: [ConversationSummaryDto] })
  items!: ConversationSummaryDto[];

  @ApiProperty({ example: 1 })
  total!: number;
}

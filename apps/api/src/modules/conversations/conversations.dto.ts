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

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const MESSAGE_TEXT_MAX_LENGTH = 2000;

// Counts Unicode code points, as PostgreSQL's CHAR_LENGTH does in Message_text_check.
// @MaxLength counts some emoji differently, so a text could pass here and fail in the database.
const MESSAGE_TEXT_MAX_LENGTH_PATTERN = new RegExp(`^[\\s\\S]{0,${MESSAGE_TEXT_MAX_LENGTH}}$`, 'u');

export const DEFAULT_CONVERSATIONS_PAGE = 1;
export const DEFAULT_CONVERSATIONS_PAGE_SIZE = 20;
export const MAX_CONVERSATIONS_PAGE_SIZE = 100;

export class CreateConversationDto {
  @ApiProperty({ example: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc' })
  @IsUUID()
  @IsString()
  tutorId!: string;
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

  @ApiPropertyOptional({
    description:
      'Client-generated key; resending with the same key returns the original message. The server generates one when it is omitted.',
    example: '0f8fad5b-d9cb-469f-a165-70867728950e',
  })
  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
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
  id!: string;

  @ApiProperty({ example: '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f' })
  conversationId!: string;

  @ApiProperty({ example: '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f' })
  senderUserId!: string;

  @ApiProperty({ example: '0f8fad5b-d9cb-469f-a165-70867728950e' })
  clientMessageId!: string;

  @ApiProperty({ example: 'Do you teach quadratic equations?' })
  text!: string;

  @ApiProperty({ example: '2026-09-30T08:05:00.000Z' })
  sentAt!: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  readAt!: string | null;
}

export class ConversationParticipantDto {
  @ApiProperty({ example: 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc' })
  id!: string;

  @ApiProperty({
    description: "The tutor's display name or the student's nickname",
    example: 'Anan Suksawat',
  })
  displayName!: string;
}

export class ConversationLastMessageDto {
  @ApiProperty({ example: 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69' })
  id!: string;

  @ApiProperty({ example: '2c9d7e1f-4a3b-4c5d-8e6f-7a8b9c0d1e2f' })
  senderUserId!: string;

  @ApiProperty({ example: 'Do you teach quadratic equations?' })
  text!: string;

  @ApiProperty({ example: '2026-09-30T08:05:00.000Z' })
  sentAt!: string;
}

export class ConversationSummaryDto {
  @ApiProperty({ example: '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f' })
  id!: string;

  @ApiProperty({ example: '2026-09-30T08:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: ConversationParticipantDto })
  otherParticipant!: ConversationParticipantDto;

  @ApiProperty({ nullable: true, type: ConversationLastMessageDto })
  lastMessage!: ConversationLastMessageDto | null;
}

export class MyConversationsResponseDto {
  @ApiProperty({ type: [ConversationSummaryDto] })
  items!: ConversationSummaryDto[];

  @ApiProperty({ example: 1 })
  total!: number;
}

import { randomUUID } from 'node:crypto';

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  ConversationSummaryDto,
  CreateConversationDto,
  DEFAULT_CONVERSATIONS_PAGE,
  DEFAULT_CONVERSATIONS_PAGE_SIZE,
  GetMyConversationsQueryDto,
  MessageResponseDto,
  MyConversationsResponseDto,
  OpenConversationResponseDto,
  OtherParticipantDto,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';

export type OpenConversationInput = CreateConversationDto & { studentUserId: string };
export type GetMyConversationsInput = GetMyConversationsQueryDto & { role: Role; userId: string };
export type SendMessageInput = SendMessageDto & { conversationId: string; senderUserId: string };

export interface OpenConversationResult {
  conversation: OpenConversationResponseDto;
  created: boolean;
}

const conversationSelect = {
  createdAt: true,
  id: true,
  studentUserId: true,
  tutorUserId: true,
} satisfies Prisma.ConversationSelect;

const lastMessageSelect = {
  id: true,
  senderUserId: true,
  sentAt: true,
  text: true,
} satisfies Prisma.MessageSelect;

const messageSelect = {
  ...lastMessageSelect,
  conversationId: true,
  readAt: true,
} satisfies Prisma.MessageSelect;

type SelectedConversation = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;
type LastMessage = Prisma.MessageGetPayload<{ select: typeof lastMessageSelect }>;
type SelectedMessage = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

interface ConversationPair {
  studentUserId: string;
  tutorUserId: string;
}

interface ConversationListRow {
  id: string;
  createdAt: Date;
  studentUserId: string;
  studentNickname: string | null;
  tutorUserId: string;
  tutorDisplayName: string;
  lastMessageId: string | null;
  lastMessageSenderUserId: string | null;
  lastMessageText: string | null;
  lastMessageSentAt: Date | null;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async openConversation(input: OpenConversationInput): Promise<OpenConversationResult> {
    await this.assertActiveStudentWithProfile(input.studentUserId);

    const tutor = await this.prisma.tutorProfile.findFirst({
      where: { ...publicTutorWhere, userId: input.tutorId },
      select: { userId: true },
    });
    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const pair = { studentUserId: input.studentUserId, tutorUserId: tutor.userId };

    const existing = await this.findConversationByPair(pair);
    if (existing) {
      return { conversation: toOpenConversationResponse(existing), created: false };
    }

    try {
      const conversation = await this.prisma.conversation.create({
        data: pair,
        select: conversationSelect,
      });
      return { conversation: toOpenConversationResponse(conversation), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // A concurrent request created the same pair first, so return that conversation.
      const winner = await this.findConversationByPair(pair);
      if (!winner) throw error;
      return { conversation: toOpenConversationResponse(winner), created: false };
    }
  }

  async getMyConversations(input: GetMyConversationsInput): Promise<MyConversationsResponseDto> {
    if (input.role !== Role.STUDENT && input.role !== Role.TUTOR) {
      throw new ForbiddenException('Only students and tutors have conversations.');
    }

    const viewerIsStudent = input.role === Role.STUDENT;
    const { skip, take } = conversationPagination(input);
    const participantFilter = viewerIsStudent
      ? Prisma.sql`c."studentUserId" = ${input.userId}`
      : Prisma.sql`c."tutorUserId" = ${input.userId}`;

    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<ConversationListRow[]>(Prisma.sql`
        SELECT
          c."id",
          c."createdAt",
          c."studentUserId",
          sp."nickname" AS "studentNickname",
          c."tutorUserId",
          tp."displayName" AS "tutorDisplayName",
          last_message."id" AS "lastMessageId",
          last_message."senderUserId" AS "lastMessageSenderUserId",
          last_message."text" AS "lastMessageText",
          last_message."sentAt" AS "lastMessageSentAt"
        FROM "Conversation" c
        JOIN "TutorProfile" tp ON tp."userId" = c."tutorUserId"
        LEFT JOIN "StudentProfile" sp ON sp."userId" = c."studentUserId"
        LEFT JOIN LATERAL (
          SELECT m."id", m."senderUserId", m."text", m."sentAt"
          FROM "Message" m
          WHERE m."conversationId" = c."id"
          ORDER BY m."sentAt" DESC, m."id" DESC
          LIMIT 1
        ) last_message ON TRUE
        WHERE ${participantFilter}
        ORDER BY COALESCE(last_message."sentAt", c."createdAt") DESC, c."id" DESC
        LIMIT ${take} OFFSET ${skip}`),
      this.prisma.conversation.count({
        where: viewerIsStudent ? { studentUserId: input.userId } : { tutorUserId: input.userId },
      }),
    ]);

    return {
      items: rows.map((row) =>
        buildSummary(row, listRowParticipant(row, viewerIsStudent), listRowLastMessage(row)),
      ),
      total,
    };
  }

  async sendMessage(input: SendMessageInput): Promise<MessageResponseDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { studentUserId: true, tutorUserId: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (
      input.senderUserId !== conversation.studentUserId &&
      input.senderUserId !== conversation.tutorUserId
    ) {
      throw new ForbiddenException('Only participants can send messages in this conversation.');
    }

    const message = await this.prisma.message.create({
      data: {
        // The database requires a key per sender, and API-02 does not take one from the client.
        clientMessageId: randomUUID(),
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        text: input.text,
      },
      select: messageSelect,
    });
    return toMessageResponse(message);
  }

  private async assertActiveStudentWithProfile(studentUserId: string): Promise<void> {
    const student = await this.prisma.user.findUnique({
      where: { id: studentUserId },
      select: {
        accountStatus: true,
        deletedAt: true,
        role: true,
        studentProfile: { select: { userId: true } },
      },
    });
    if (
      !student ||
      student.role !== Role.STUDENT ||
      student.accountStatus !== AccountStatus.ACTIVE ||
      student.deletedAt
    ) {
      throw new ForbiddenException('Only active students can start conversations.');
    }
    if (student.studentProfile === null) {
      throw new ForbiddenException(
        'Students must complete their profile before starting a conversation.',
      );
    }
  }

  private findConversationByPair(pair: ConversationPair): Promise<SelectedConversation | null> {
    return this.prisma.conversation.findUnique({
      where: { studentUserId_tutorUserId: pair },
      select: conversationSelect,
    });
  }
}

function conversationPagination(input: { page?: number; pageSize?: number }): {
  skip: number;
  take: number;
} {
  const page = input.page ?? DEFAULT_CONVERSATIONS_PAGE;
  const take = input.pageSize ?? DEFAULT_CONVERSATIONS_PAGE_SIZE;
  return { skip: (page - 1) * take, take };
}

/** Prisma reports a unique violation from a client query as P2002; a raw SQLSTATE never reaches `code`. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function toOpenConversationResponse(
  conversation: SelectedConversation,
): OpenConversationResponseDto {
  return {
    conversationId: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
    participants: [
      { role: Role.STUDENT, userId: conversation.studentUserId },
      { role: Role.TUTOR, userId: conversation.tutorUserId },
    ],
  };
}

function buildSummary(
  conversation: SelectedConversation,
  otherParticipant: OtherParticipantDto,
  lastMessage: LastMessage | null,
): ConversationSummaryDto {
  return {
    conversationId: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
    lastMessage:
      lastMessage === null
        ? null
        : {
            messageId: lastMessage.id,
            senderId: lastMessage.senderUserId,
            sentAt: lastMessage.sentAt.toISOString(),
            text: lastMessage.text,
          },
    otherParticipant,
  };
}

function listRowParticipant(
  row: ConversationListRow,
  viewerIsStudent: boolean,
): OtherParticipantDto {
  if (viewerIsStudent) {
    return { displayName: row.tutorDisplayName, userId: row.tutorUserId };
  }

  // Starting a conversation requires a student profile, so the nickname is always present.
  // The fallback only covers the LEFT JOIN's nullable type.
  return { displayName: row.studentNickname ?? '', userId: row.studentUserId };
}

function listRowLastMessage(row: ConversationListRow): LastMessage | null {
  if (
    row.lastMessageId === null ||
    row.lastMessageSenderUserId === null ||
    row.lastMessageText === null ||
    row.lastMessageSentAt === null
  ) {
    return null;
  }

  return {
    id: row.lastMessageId,
    senderUserId: row.lastMessageSenderUserId,
    sentAt: row.lastMessageSentAt,
    text: row.lastMessageText,
  };
}

function toMessageResponse(message: SelectedMessage): MessageResponseDto {
  return {
    conversationId: message.conversationId,
    messageId: message.id,
    readAt: message.readAt?.toISOString() ?? null,
    senderId: message.senderUserId,
    sentAt: message.sentAt.toISOString(),
    text: message.text,
  };
}

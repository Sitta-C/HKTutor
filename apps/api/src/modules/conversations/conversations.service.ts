import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  decodeConversationCursor,
  encodeConversationCursor,
} from '@modules/conversations/conversations.cursor';
import {
  ConversationSummaryDto,
  CreateConversationDto,
  DEFAULT_CONVERSATIONS_LIMIT,
  DEFAULT_MESSAGES_PAGE_SIZE,
  GetMessagesQueryDto,
  GetMyConversationsQueryDto,
  MarkMessagesReadDto,
  MarkMessagesReadResponseDto,
  MessageHistoryResponseDto,
  MessageResponseDto,
  MyConversationsResponseDto,
  OpenConversationResponseDto,
  OtherParticipantDto,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';

export type OpenConversationInput = CreateConversationDto & { role: Role; userId: string };
export type GetMyConversationsInput = GetMyConversationsQueryDto & { role: Role; userId: string };
export type SendMessageInput = SendMessageDto & { conversationId: string; senderUserId: string };
export type GetMessagesInput = GetMessagesQueryDto & { conversationId: string; userId: string };
export type MarkMessagesReadInput = MarkMessagesReadDto & {
  conversationId: string;
  userId: string;
};

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

// A tutor sees the student's nickname in the conversation list, so the student needs a profile.
const contactableStudentWhere = {
  user: { accountStatus: AccountStatus.ACTIVE, deletedAt: null, role: Role.STUDENT },
} satisfies Prisma.StudentProfileWhereInput;

interface ConversationPair {
  studentUserId: string;
  tutorUserId: string;
}

interface MessageCursor {
  id: string;
  sentAt: Date;
}

interface ReadReceiptRow {
  readAt: Date | null;
  updatedCount: number;
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
  activityAt: Date;
  unreadCount: number;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async openConversation(input: OpenConversationInput): Promise<OpenConversationResult> {
    const pair = await this.resolvePair(input);

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

    const cursor = input.cursor === undefined ? undefined : decodeConversationCursor(input.cursor);
    const limit = input.limit ?? DEFAULT_CONVERSATIONS_LIMIT;
    const viewerIsStudent = input.role === Role.STUDENT;
    const participantFilter = viewerIsStudent
      ? Prisma.sql`c."studentUserId" = ${input.userId}`
      : Prisma.sql`c."tutorUserId" = ${input.userId}`;
    const afterCursor =
      cursor === undefined
        ? Prisma.empty
        : Prisma.sql`AND (COALESCE(last_message."sentAt", c."createdAt"), c."id") < (${cursor.activityAt}::timestamptz, ${cursor.id}::uuid)`;

    // One extra row tells whether another page follows, without counting every conversation.
    const rows = await this.prisma.$queryRaw<ConversationListRow[]>(Prisma.sql`
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
        last_message."sentAt" AS "lastMessageSentAt",
        COALESCE(last_message."sentAt", c."createdAt") AS "activityAt",
        unread."unreadCount"
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
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS "unreadCount"
        FROM "Message" m
        WHERE m."conversationId" = c."id"
          AND m."senderUserId" <> ${input.userId}
          AND m."readAt" IS NULL
      ) unread
      WHERE ${participantFilter}
        ${afterCursor}
      ORDER BY COALESCE(last_message."sentAt", c."createdAt") DESC, c."id" DESC
      LIMIT ${limit + 1}`);
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => buildSummary(row, viewerIsStudent)),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeConversationCursor({ activityAt: last.activityAt.toISOString(), id: last.id })
          : null,
    };
  }

  async sendMessage(input: SendMessageInput): Promise<MessageResponseDto> {
    await this.assertParticipant(
      input.conversationId,
      input.senderUserId,
      'Only participants can send messages in this conversation.',
    );

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

  /** Read-only: a page of messages after the cursor, oldest first. */
  async getMessages(input: GetMessagesInput): Promise<MessageHistoryResponseDto> {
    await this.assertParticipant(
      input.conversationId,
      input.userId,
      'Only participants can read this conversation.',
    );
    const cursor =
      input.afterMessageId === undefined
        ? undefined
        : await this.findMessageInConversation(
            input.conversationId,
            input.afterMessageId,
            'afterMessageId',
          );
    const pageSize = input.pageSize ?? DEFAULT_MESSAGES_PAGE_SIZE;

    // One extra row tells whether another page follows, without a second query.
    const rows = await this.prisma.message.findMany({
      where:
        cursor === undefined
          ? { conversationId: input.conversationId }
          : { conversationId: input.conversationId, ...sentAfter(cursor) },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      select: messageSelect,
      take: pageSize + 1,
    });
    const items = rows.slice(0, pageSize).map((message) => toMessageResponse(message));

    return {
      hasMore: rows.length > pageSize,
      items,
      // Polling resends this, so an empty page keeps the request's cursor.
      nextAfterMessageId: items.at(-1)?.messageId ?? input.afterMessageId ?? null,
    };
  }

  /** Marks the other participant's unread messages read, once; the caller's own are never touched. */
  async markMessagesRead(input: MarkMessagesReadInput): Promise<MarkMessagesReadResponseDto> {
    await this.assertParticipant(
      input.conversationId,
      input.userId,
      'Only participants can mark messages read in this conversation.',
    );
    const upTo =
      input.upToMessageId === undefined
        ? undefined
        : await this.findMessageInConversation(
            input.conversationId,
            input.upToMessageId,
            'upToMessageId',
          );

    // The database clock sets readAt. GREATEST keeps Message_read_time_check (readAt >= sentAt)
    // true even for a message whose sentAt is later than this statement's now().
    const [result] = await this.prisma.$queryRaw<ReadReceiptRow[]>(Prisma.sql`
      WITH updated AS (
        UPDATE "Message"
        SET "readAt" = GREATEST(now(), "sentAt")
        WHERE "conversationId" = ${input.conversationId}
          AND "senderUserId" <> ${input.userId}
          AND "readAt" IS NULL
          ${upTo === undefined ? Prisma.empty : Prisma.sql`AND ("sentAt", "id") <= (${upTo.sentAt}::timestamptz, ${upTo.id}::uuid)`}
        RETURNING "readAt"
      )
      SELECT count(*)::int AS "updatedCount", max("readAt") AS "readAt" FROM updated`);

    return {
      readAt: result?.readAt?.toISOString() ?? null,
      updatedCount: result?.updatedCount ?? 0,
    };
  }

  /** Throws 404 for a missing conversation and 403 for anyone outside it. */
  private async assertParticipant(
    conversationId: string,
    userId: string,
    forbiddenMessage: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { studentUserId: true, tutorUserId: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (userId !== conversation.studentUserId && userId !== conversation.tutorUserId) {
      throw new ForbiddenException(forbiddenMessage);
    }
  }

  private async findMessageInConversation(
    conversationId: string,
    messageId: string,
    field: 'afterMessageId' | 'upToMessageId',
  ): Promise<MessageCursor> {
    const message = await this.prisma.message.findFirst({
      where: { conversationId, id: messageId },
      select: { id: true, sentAt: true },
    });
    if (!message) {
      throw new BadRequestException(`${field} must be a message in this conversation.`);
    }
    return message;
  }

  /** Checks both sides and returns the pair as student and tutor, whoever opened it. */
  private async resolvePair(input: OpenConversationInput): Promise<ConversationPair> {
    if (input.role !== Role.STUDENT && input.role !== Role.TUTOR) {
      throw new ForbiddenException('Only students and tutors can start conversations.');
    }
    const targetUserId = conversationTarget(input);

    if (input.role === Role.STUDENT) {
      await this.assertActiveStudentWithProfile(input.userId);
      if (!(await this.isPublicTutor(targetUserId))) {
        throw new NotFoundException('Tutor not found');
      }
      return { studentUserId: input.userId, tutorUserId: targetUserId };
    }

    if (!(await this.isPublicTutor(input.userId))) {
      throw new ForbiddenException('Only verified tutors can start conversations.');
    }
    const student = await this.prisma.studentProfile.findFirst({
      where: { ...contactableStudentWhere, userId: targetUserId },
      select: { userId: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    return { studentUserId: targetUserId, tutorUserId: input.userId };
  }

  private async isPublicTutor(tutorUserId: string): Promise<boolean> {
    const tutor = await this.prisma.tutorProfile.findFirst({
      where: { ...publicTutorWhere, userId: tutorUserId },
      select: { userId: true },
    });
    return tutor !== null;
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

/**
 * The other participant's user ID. API-01 takes tutorId from a student and participantId from a
 * tutor, so a missing or extra key fails here, as does the caller's own ID, before any query.
 */
function conversationTarget(input: OpenConversationInput): string {
  const callerIsStudent = input.role === Role.STUDENT;
  const target = callerIsStudent ? input.tutorId : input.participantId;
  const otherKey = callerIsStudent ? input.participantId : input.tutorId;

  if (typeof target !== 'string' || otherKey !== undefined) {
    throw new BadRequestException(
      callerIsStudent
        ? 'A student must send tutorId and no participantId.'
        : 'A tutor must send participantId and no tutorId.',
    );
  }
  // UUIDs are case-insensitive, so an upper-case copy of the caller's ID is still the caller.
  if (target.toLowerCase() === input.userId.toLowerCase()) {
    throw new BadRequestException('You cannot start a conversation with yourself.');
  }
  return target;
}

/** Messages after the cursor in (sentAt, id) order, the order the history is returned in. */
function sentAfter(cursor: MessageCursor): Prisma.MessageWhereInput {
  return {
    OR: [{ sentAt: { gt: cursor.sentAt } }, { id: { gt: cursor.id }, sentAt: cursor.sentAt }],
  };
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

function buildSummary(row: ConversationListRow, viewerIsStudent: boolean): ConversationSummaryDto {
  const lastMessage = listRowLastMessage(row);
  return {
    conversationId: row.id,
    createdAt: row.createdAt.toISOString(),
    lastMessage:
      lastMessage === null
        ? null
        : {
            messageId: lastMessage.id,
            senderId: lastMessage.senderUserId,
            sentAt: lastMessage.sentAt.toISOString(),
            text: lastMessage.text,
          },
    otherParticipant: listRowParticipant(row, viewerIsStudent),
    unreadCount: row.unreadCount,
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

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  ConversationParticipantDto,
  ConversationSummaryDto,
  CreateConversationDto,
  DEFAULT_CONVERSATIONS_PAGE,
  DEFAULT_CONVERSATIONS_PAGE_SIZE,
  GetMyConversationsQueryDto,
  MessageResponseDto,
  MyConversationsResponseDto,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';

export type OpenConversationInput = CreateConversationDto & { studentUserId: string };
export type GetMyConversationsInput = GetMyConversationsQueryDto & { role: Role; userId: string };
export type SendMessageInput = SendMessageDto & { conversationId: string; senderUserId: string };

export interface OpenConversationResult {
  conversation: ConversationSummaryDto;
  created: boolean;
}

const conversationSelect = { createdAt: true, id: true } satisfies Prisma.ConversationSelect;

const lastMessageSelect = {
  body: true,
  createdAt: true,
  id: true,
  senderUserId: true,
} satisfies Prisma.MessageSelect;

const messageSelect = {
  ...lastMessageSelect,
  clientMessageId: true,
  conversationId: true,
  readAt: true,
} satisfies Prisma.MessageSelect;

type SelectedConversation = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;
type LastMessage = Prisma.MessageGetPayload<{ select: typeof lastMessageSelect }>;
type SelectedMessage = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

interface ConversationPair {
  studentUserId: string;
  tutorProfileId: string;
}

interface ConversationListRow {
  id: string;
  createdAt: Date;
  studentUserId: string;
  studentNickname: string | null;
  tutorProfileId: string;
  tutorDisplayName: string;
  lastMessageId: string | null;
  lastMessageSenderUserId: string | null;
  lastMessageBody: string | null;
  lastMessageCreatedAt: Date | null;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async openConversation(input: OpenConversationInput): Promise<OpenConversationResult> {
    await this.assertActiveStudentWithProfile(input.studentUserId);

    const tutor = await this.prisma.tutorProfile.findFirst({
      where: { ...publicTutorWhere, userId: input.tutorId },
      select: { displayName: true, userId: true },
    });
    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    const pair = { studentUserId: input.studentUserId, tutorProfileId: tutor.userId };
    const otherParticipant = { displayName: tutor.displayName, id: tutor.userId };

    const existing = await this.findConversationByPair(pair);
    if (existing) {
      return {
        conversation: await this.summarizeExisting(existing, otherParticipant),
        created: false,
      };
    }

    try {
      const conversation = await this.prisma.conversation.create({
        data: pair,
        select: conversationSelect,
      });
      return { conversation: buildSummary(conversation, otherParticipant, null), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // A concurrent request created the same pair first, so return that conversation.
      const winner = await this.findConversationByPair(pair);
      if (!winner) throw error;
      return {
        conversation: await this.summarizeExisting(winner, otherParticipant),
        created: false,
      };
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
      : Prisma.sql`c."tutorProfileId" = ${input.userId}`;

    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<ConversationListRow[]>(Prisma.sql`
        SELECT
          c."id",
          c."createdAt",
          c."studentUserId",
          sp."nickname" AS "studentNickname",
          c."tutorProfileId",
          tp."displayName" AS "tutorDisplayName",
          last_message."id" AS "lastMessageId",
          last_message."senderUserId" AS "lastMessageSenderUserId",
          last_message."body" AS "lastMessageBody",
          last_message."createdAt" AS "lastMessageCreatedAt"
        FROM "Conversation" c
        JOIN "TutorProfile" tp ON tp."userId" = c."tutorProfileId"
        LEFT JOIN "StudentProfile" sp ON sp."userId" = c."studentUserId"
        LEFT JOIN LATERAL (
          SELECT m."id", m."senderUserId", m."body", m."createdAt"
          FROM "Message" m
          WHERE m."conversationId" = c."id"
          ORDER BY m."createdAt" DESC, m."id" DESC
          LIMIT 1
        ) last_message ON TRUE
        WHERE ${participantFilter}
        ORDER BY COALESCE(last_message."createdAt", c."createdAt") DESC, c."id" DESC
        LIMIT ${take} OFFSET ${skip}`),
      this.prisma.conversation.count({
        where: viewerIsStudent ? { studentUserId: input.userId } : { tutorProfileId: input.userId },
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
      select: { studentUserId: true, tutorProfileId: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (
      input.senderUserId !== conversation.studentUserId &&
      input.senderUserId !== conversation.tutorProfileId
    ) {
      throw new ForbiddenException('Only participants can send messages in this conversation.');
    }

    try {
      const message = await this.prisma.message.create({
        data: {
          body: input.body,
          clientMessageId: input.clientMessageId ?? null,
          conversationId: input.conversationId,
          senderUserId: input.senderUserId,
        },
        select: messageSelect,
      });
      return toMessageResponse(message);
    } catch (error) {
      if (!input.clientMessageId || !isUniqueViolation(error)) throw error;

      // A retry reused clientMessageId, so return the message the first attempt stored.
      const original = await this.findMessageByClientId(input.senderUserId, input.clientMessageId);
      if (!original) throw error;
      if (original.conversationId !== input.conversationId) {
        throw new ConflictException('clientMessageId was already used in another conversation.');
      }
      return toMessageResponse(original);
    }
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
      where: { studentUserId_tutorProfileId: pair },
      select: conversationSelect,
    });
  }

  private async summarizeExisting(
    conversation: SelectedConversation,
    otherParticipant: ConversationParticipantDto,
  ): Promise<ConversationSummaryDto> {
    const lastMessage = await this.prisma.message.findFirst({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: lastMessageSelect,
    });
    return buildSummary(conversation, otherParticipant, lastMessage);
  }

  private findMessageByClientId(
    senderUserId: string,
    clientMessageId: string,
  ): Promise<SelectedMessage | null> {
    return this.prisma.message.findFirst({
      where: { clientMessageId, senderUserId },
      select: messageSelect,
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

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = String((error as { code?: string }).code ?? '');
  return code === 'P2002' || code === '23505';
}

function buildSummary(
  conversation: SelectedConversation,
  otherParticipant: ConversationParticipantDto,
  lastMessage: LastMessage | null,
): ConversationSummaryDto {
  return {
    createdAt: conversation.createdAt.toISOString(),
    id: conversation.id,
    lastMessage:
      lastMessage === null
        ? null
        : {
            body: lastMessage.body,
            createdAt: lastMessage.createdAt.toISOString(),
            id: lastMessage.id,
            senderUserId: lastMessage.senderUserId,
          },
    otherParticipant,
  };
}

function listRowParticipant(
  row: ConversationListRow,
  viewerIsStudent: boolean,
): ConversationParticipantDto {
  if (viewerIsStudent) {
    return { displayName: row.tutorDisplayName, id: row.tutorProfileId };
  }

  // Starting a conversation requires a student profile, so the nickname is always present.
  // The fallback only covers the LEFT JOIN's nullable type.
  return { displayName: row.studentNickname ?? '', id: row.studentUserId };
}

function listRowLastMessage(row: ConversationListRow): LastMessage | null {
  if (
    row.lastMessageId === null ||
    row.lastMessageSenderUserId === null ||
    row.lastMessageBody === null ||
    row.lastMessageCreatedAt === null
  ) {
    return null;
  }

  return {
    body: row.lastMessageBody,
    createdAt: row.lastMessageCreatedAt,
    id: row.lastMessageId,
    senderUserId: row.lastMessageSenderUserId,
  };
}

function toMessageResponse(message: SelectedMessage): MessageResponseDto {
  return {
    body: message.body,
    clientMessageId: message.clientMessageId,
    conversationId: message.conversationId,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    readAt: message.readAt?.toISOString() ?? null,
    senderUserId: message.senderUserId,
  };
}

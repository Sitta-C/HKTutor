import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';

import type { Prisma } from '@generated/prisma/client';
import type { TestingModule } from '@nestjs/testing';

const STUDENT_ID = '6bb01222-1fce-4bc3-a69d-3d90db2fdf57';
const OTHER_STUDENT_ID = '9d3c5a1e-2b4f-4e6a-8c7d-0f1e2d3c4b5a';
const ADMIN_ID = '4a7b2c9d-1e3f-4a5b-8c6d-7e8f9a0b1c2d';
const TUTOR_ID = '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857';
const CONVERSATION_ID = '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f';
const OTHER_CONVERSATION_ID = '3e2d1c0b-9a8f-4e7d-b6c5-a4b3c2d1e0f9';
const MESSAGE_ID = 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69';
const US2_1_MESSAGE = 'Do you teach quadratic equations?';
const CREATED_AT = new Date('2026-09-30T08:00:00.000Z');
const SENT_AT = new Date('2026-09-30T08:05:00.000Z');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type DatabaseError = Error & { code: string };

interface CreatedMessageData {
  clientMessageId: string;
  conversationId: string;
  senderUserId: string;
  text: string;
}

const createDatabaseError = (code: string): DatabaseError =>
  Object.assign(new Error(`Database error ${code}`), { code });

const activeStudent = {
  accountStatus: AccountStatus.ACTIVE,
  deletedAt: null,
  role: Role.STUDENT,
  studentProfile: { userId: STUDENT_ID },
};

const publicTutor = { userId: TUTOR_ID };

const conversationRow = {
  createdAt: CREATED_AT,
  id: CONVERSATION_ID,
  studentUserId: STUDENT_ID,
  tutorUserId: TUTOR_ID,
};

const openedConversation = {
  conversationId: CONVERSATION_ID,
  createdAt: CREATED_AT.toISOString(),
  participants: [
    { role: Role.STUDENT, userId: STUDENT_ID },
    { role: Role.TUTOR, userId: TUTOR_ID },
  ],
};

const lastMessage = {
  id: MESSAGE_ID,
  senderUserId: STUDENT_ID,
  sentAt: SENT_AT,
  text: US2_1_MESSAGE,
};

const storedMessage = (overrides: Record<string, unknown> = {}) => ({
  ...lastMessage,
  conversationId: CONVERSATION_ID,
  readAt: null,
  ...overrides,
});

describe('ConversationsService', () => {
  let service: ConversationsService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    conversation: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    message: { create: jest.fn() },
    tutorProfile: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  describe('openConversation', () => {
    const openAsStudent = () =>
      service.openConversation({ studentUserId: STUDENT_ID, tutorId: TUTOR_ID });

    beforeEach(() => {
      mockPrismaService.user.findUnique.mockResolvedValue(activeStudent);
      mockPrismaService.tutorProfile.findFirst.mockResolvedValue(publicTutor);
    });

    it('creates a conversation between an active student with a profile and a public tutor', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);
      mockPrismaService.conversation.create.mockResolvedValue(conversationRow);

      await expect(openAsStudent()).resolves.toEqual({
        conversation: openedConversation,
        created: true,
      });
      expect(mockPrismaService.tutorProfile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ...publicTutorWhere, userId: TUTOR_ID } }),
      );
      expect(mockPrismaService.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID } }),
      );
    });

    it('returns the existing conversation in the same shape instead of creating another', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(conversationRow);

      await expect(openAsStudent()).resolves.toEqual({
        conversation: openedConversation,
        created: false,
      });
      expect(mockPrismaService.conversation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentUserId_tutorUserId: { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID },
          },
        }),
      );
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });

    it('returns the conversation a concurrent request created first', async () => {
      mockPrismaService.conversation.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(conversationRow);
      mockPrismaService.conversation.create.mockRejectedValue(createDatabaseError('P2002'));

      await expect(openAsStudent()).resolves.toEqual({
        conversation: openedConversation,
        created: false,
      });
    });

    it('rethrows database errors other than a duplicate pair', async () => {
      const error = createDatabaseError('P1001');
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);
      mockPrismaService.conversation.create.mockRejectedValue(error);

      await expect(openAsStudent()).rejects.toBe(error);
    });

    it.each([
      ['a missing account', null],
      ['a tutor account', { ...activeStudent, role: Role.TUTOR }],
      ['a suspended student', { ...activeStudent, accountStatus: AccountStatus.SUSPENDED }],
      ['a deleted student', { ...activeStudent, deletedAt: new Date('2026-09-01T00:00:00.000Z') }],
    ])('rejects %s with 403 and creates nothing', async (_label, user) => {
      mockPrismaService.user.findUnique.mockResolvedValue(user);

      await expect(openAsStudent()).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });

    it('rejects a student without a profile with 403 and creates nothing', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...activeStudent,
        studentProfile: null,
      });

      const error = await openAsStudent().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error).toHaveProperty(
        'message',
        'Students must complete their profile before starting a conversation.',
      );
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });

    it('returns 404 for a tutor who is not public and creates nothing', async () => {
      mockPrismaService.tutorProfile.findFirst.mockResolvedValue(null);

      await expect(openAsStudent()).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });
  });

  describe('getMyConversations', () => {
    const listRow = (overrides: Record<string, unknown> = {}) => ({
      createdAt: CREATED_AT,
      id: CONVERSATION_ID,
      lastMessageId: MESSAGE_ID,
      lastMessageSenderUserId: STUDENT_ID,
      lastMessageSentAt: SENT_AT,
      lastMessageText: US2_1_MESSAGE,
      studentNickname: 'Nan',
      studentUserId: STUDENT_ID,
      tutorDisplayName: 'Anan Suksawat',
      tutorUserId: TUTOR_ID,
      ...overrides,
    });

    const listQuery = (): Prisma.Sql | undefined =>
      (mockPrismaService.$queryRaw.mock.calls as unknown as Array<[Prisma.Sql]>)[0]?.[0];

    it("lists a student's conversations newest activity first with the tutor as the other participant", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        listRow(),
        listRow({
          id: OTHER_CONVERSATION_ID,
          lastMessageId: null,
          lastMessageSenderUserId: null,
          lastMessageSentAt: null,
          lastMessageText: null,
        }),
      ]);
      mockPrismaService.conversation.count.mockResolvedValue(2);

      await expect(
        service.getMyConversations({ role: Role.STUDENT, userId: STUDENT_ID }),
      ).resolves.toEqual({
        items: [
          {
            conversationId: CONVERSATION_ID,
            createdAt: CREATED_AT.toISOString(),
            lastMessage: {
              messageId: MESSAGE_ID,
              senderId: STUDENT_ID,
              sentAt: SENT_AT.toISOString(),
              text: US2_1_MESSAGE,
            },
            otherParticipant: { displayName: 'Anan Suksawat', userId: TUTOR_ID },
          },
          {
            conversationId: OTHER_CONVERSATION_ID,
            createdAt: CREATED_AT.toISOString(),
            lastMessage: null,
            otherParticipant: { displayName: 'Anan Suksawat', userId: TUTOR_ID },
          },
        ],
        total: 2,
      });
      expect(listQuery()?.text).toContain('c."studentUserId" = $1');
      expect(listQuery()?.text).toMatch(
        /ORDER BY COALESCE\(last_message\."sentAt", c\."createdAt"\) DESC, c\."id" DESC/,
      );
      expect(listQuery()?.values).toEqual([STUDENT_ID, 20, 0]);
      expect(mockPrismaService.conversation.count).toHaveBeenCalledWith({
        where: { studentUserId: STUDENT_ID },
      });
    });

    it("lists a tutor's conversations with the student's nickname", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([listRow()]);
      mockPrismaService.conversation.count.mockResolvedValue(1);

      const result = await service.getMyConversations({ role: Role.TUTOR, userId: TUTOR_ID });

      expect(result.items[0]?.otherParticipant).toEqual({
        displayName: 'Nan',
        userId: STUDENT_ID,
      });
      expect(listQuery()?.text).toContain('c."tutorUserId" = $1');
      expect(listQuery()?.values).toEqual([TUTOR_ID, 20, 0]);
      expect(mockPrismaService.conversation.count).toHaveBeenCalledWith({
        where: { tutorUserId: TUTOR_ID },
      });
    });

    it('applies page and pageSize', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);
      mockPrismaService.conversation.count.mockResolvedValue(25);

      await service.getMyConversations({
        page: 3,
        pageSize: 10,
        role: Role.STUDENT,
        userId: STUDENT_ID,
      });

      expect(listQuery()?.values).toEqual([STUDENT_ID, 10, 20]);
    });

    it('rejects roles other than student and tutor without querying', async () => {
      await expect(
        service.getMyConversations({ role: Role.ADMIN, userId: ADMIN_ID }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    const participants = { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID };

    const createdData = (call = 0): CreatedMessageData | undefined =>
      (
        mockPrismaService.message.create.mock.calls as unknown as Array<
          [{ data: CreatedMessageData }]
        >
      )[call]?.[0].data;

    it('stores the US2-1 message from the student and returns the API-02 fields', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockResolvedValue(storedMessage());

      await expect(
        service.sendMessage({
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
          text: US2_1_MESSAGE,
        }),
      ).resolves.toEqual({
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        readAt: null,
        senderId: STUDENT_ID,
        sentAt: SENT_AT.toISOString(),
        text: US2_1_MESSAGE,
      });
      expect(createdData()).toMatchObject({
        conversationId: CONVERSATION_ID,
        senderUserId: STUDENT_ID,
        text: US2_1_MESSAGE,
      });
    });

    it('generates a fresh clientMessageId for every message', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockResolvedValue(storedMessage());
      const sendHello = () =>
        service.sendMessage({
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
          text: 'Hello',
        });

      await sendHello();
      await sendHello();

      expect(createdData(0)?.clientMessageId).toMatch(UUID_V4);
      expect(createdData(1)?.clientMessageId).toMatch(UUID_V4);
      expect(createdData(1)?.clientMessageId).not.toBe(createdData(0)?.clientMessageId);
    });

    it('lets the tutor reply in the same conversation', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockResolvedValue(
        storedMessage({ senderUserId: TUTOR_ID, text: 'Yes, I do.' }),
      );

      await expect(
        service.sendMessage({
          conversationId: CONVERSATION_ID,
          senderUserId: TUTOR_ID,
          text: 'Yes, I do.',
        }),
      ).resolves.toMatchObject({ senderId: TUTOR_ID, text: 'Yes, I do.' });
      expect(createdData()).toMatchObject({
        conversationId: CONVERSATION_ID,
        senderUserId: TUTOR_ID,
        text: 'Yes, I do.',
      });
    });

    it('returns 404 for a conversation that does not exist and stores nothing', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.sendMessage({
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
          text: 'Hello',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it.each([
      ['another student', OTHER_STUDENT_ID],
      ['an admin', ADMIN_ID],
    ])('returns 403 to %s and stores nothing', async (_label, senderUserId) => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);

      await expect(
        service.sendMessage({ conversationId: CONVERSATION_ID, senderUserId, text: 'Hello' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a duplicate key', 'P2002'],
      ['an unrelated database error', 'P1001'],
    ])('rethrows %s without retrying', async (_label, code) => {
      const error = createDatabaseError(code);
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockRejectedValue(error);

      await expect(
        service.sendMessage({
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
          text: 'Hello',
        }),
      ).rejects.toBe(error);
      expect(mockPrismaService.message.create).toHaveBeenCalledTimes(1);
    });
  });
});

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
const CLIENT_MESSAGE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const US2_1_MESSAGE = 'Do you teach quadratic equations?';
const CREATED_AT = new Date('2026-09-30T08:00:00.000Z');
const SENT_AT = new Date('2026-09-30T08:05:00.000Z');

type DatabaseError = Error & { code: string };

const createDatabaseError = (code: string): DatabaseError =>
  Object.assign(new Error(`Database error ${code}`), { code });

const activeStudent = {
  accountStatus: AccountStatus.ACTIVE,
  deletedAt: null,
  role: Role.STUDENT,
  studentProfile: { userId: STUDENT_ID },
};

const publicTutor = { displayName: 'Anan Suksawat', userId: TUTOR_ID };

const lastMessage = {
  body: US2_1_MESSAGE,
  createdAt: SENT_AT,
  id: MESSAGE_ID,
  senderUserId: STUDENT_ID,
};

const storedMessage = (overrides: Record<string, unknown> = {}) => ({
  ...lastMessage,
  clientMessageId: null,
  conversationId: CONVERSATION_ID,
  readAt: null,
  ...overrides,
});

describe('ConversationsService', () => {
  let service: ConversationsService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
    conversation: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    message: { create: jest.fn(), findFirst: jest.fn() },
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
      mockPrismaService.conversation.create.mockResolvedValue({
        createdAt: CREATED_AT,
        id: CONVERSATION_ID,
      });

      await expect(openAsStudent()).resolves.toEqual({
        conversation: {
          createdAt: CREATED_AT.toISOString(),
          id: CONVERSATION_ID,
          lastMessage: null,
          otherParticipant: { displayName: 'Anan Suksawat', id: TUTOR_ID },
        },
        created: true,
      });
      expect(mockPrismaService.tutorProfile.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ...publicTutorWhere, userId: TUTOR_ID } }),
      );
      expect(mockPrismaService.conversation.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { studentUserId: STUDENT_ID, tutorProfileId: TUTOR_ID } }),
      );
    });

    it('returns the existing conversation with its latest message instead of creating another', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue({
        createdAt: CREATED_AT,
        id: CONVERSATION_ID,
      });
      mockPrismaService.message.findFirst.mockResolvedValue(lastMessage);

      await expect(openAsStudent()).resolves.toEqual({
        conversation: {
          createdAt: CREATED_AT.toISOString(),
          id: CONVERSATION_ID,
          lastMessage: {
            body: US2_1_MESSAGE,
            createdAt: SENT_AT.toISOString(),
            id: MESSAGE_ID,
            senderUserId: STUDENT_ID,
          },
          otherParticipant: { displayName: 'Anan Suksawat', id: TUTOR_ID },
        },
        created: false,
      });
      expect(mockPrismaService.conversation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            studentUserId_tutorProfileId: { studentUserId: STUDENT_ID, tutorProfileId: TUTOR_ID },
          },
        }),
      );
      expect(mockPrismaService.message.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          where: { conversationId: CONVERSATION_ID },
        }),
      );
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    });

    it('returns the conversation a concurrent request created first', async () => {
      mockPrismaService.conversation.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ createdAt: CREATED_AT, id: CONVERSATION_ID });
      mockPrismaService.conversation.create.mockRejectedValue(createDatabaseError('P2002'));
      mockPrismaService.message.findFirst.mockResolvedValue(null);

      await expect(openAsStudent()).resolves.toMatchObject({
        conversation: { id: CONVERSATION_ID, lastMessage: null },
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
      expect((error as ForbiddenException).message).toBe(
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
      lastMessageBody: US2_1_MESSAGE,
      lastMessageCreatedAt: SENT_AT,
      lastMessageId: MESSAGE_ID,
      lastMessageSenderUserId: STUDENT_ID,
      studentNickname: 'Nan',
      studentUserId: STUDENT_ID,
      tutorDisplayName: 'Anan Suksawat',
      tutorProfileId: TUTOR_ID,
      ...overrides,
    });

    const listQuery = (): Prisma.Sql | undefined =>
      (mockPrismaService.$queryRaw.mock.calls as unknown as Array<[Prisma.Sql]>)[0]?.[0];

    it("lists a student's conversations newest activity first with the tutor as the other participant", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        listRow(),
        listRow({
          id: OTHER_CONVERSATION_ID,
          lastMessageBody: null,
          lastMessageCreatedAt: null,
          lastMessageId: null,
          lastMessageSenderUserId: null,
        }),
      ]);
      mockPrismaService.conversation.count.mockResolvedValue(2);

      await expect(
        service.getMyConversations({ role: Role.STUDENT, userId: STUDENT_ID }),
      ).resolves.toEqual({
        items: [
          {
            createdAt: CREATED_AT.toISOString(),
            id: CONVERSATION_ID,
            lastMessage: {
              body: US2_1_MESSAGE,
              createdAt: SENT_AT.toISOString(),
              id: MESSAGE_ID,
              senderUserId: STUDENT_ID,
            },
            otherParticipant: { displayName: 'Anan Suksawat', id: TUTOR_ID },
          },
          {
            createdAt: CREATED_AT.toISOString(),
            id: OTHER_CONVERSATION_ID,
            lastMessage: null,
            otherParticipant: { displayName: 'Anan Suksawat', id: TUTOR_ID },
          },
        ],
        total: 2,
      });
      expect(listQuery()?.text).toContain('c."studentUserId" = $1');
      expect(listQuery()?.text).toMatch(
        /ORDER BY COALESCE\(last_message\."createdAt", c\."createdAt"\) DESC, c\."id" DESC/,
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

      expect(result.items[0]?.otherParticipant).toEqual({ displayName: 'Nan', id: STUDENT_ID });
      expect(listQuery()?.text).toContain('c."tutorProfileId" = $1');
      expect(listQuery()?.values).toEqual([TUTOR_ID, 20, 0]);
      expect(mockPrismaService.conversation.count).toHaveBeenCalledWith({
        where: { tutorProfileId: TUTOR_ID },
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
    const participants = { studentUserId: STUDENT_ID, tutorProfileId: TUTOR_ID };

    it('stores the US2-1 message from the student and returns it', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockResolvedValue(storedMessage());

      await expect(
        service.sendMessage({
          body: US2_1_MESSAGE,
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
        }),
      ).resolves.toEqual({
        body: US2_1_MESSAGE,
        clientMessageId: null,
        conversationId: CONVERSATION_ID,
        createdAt: SENT_AT.toISOString(),
        id: MESSAGE_ID,
        readAt: null,
        senderUserId: STUDENT_ID,
      });
      expect(mockPrismaService.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            body: US2_1_MESSAGE,
            clientMessageId: null,
            conversationId: CONVERSATION_ID,
            senderUserId: STUDENT_ID,
          },
        }),
      );
    });

    it('lets the tutor reply in the same conversation', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockResolvedValue(
        storedMessage({ body: 'Yes, I do.', senderUserId: TUTOR_ID }),
      );

      await expect(
        service.sendMessage({
          body: 'Yes, I do.',
          conversationId: CONVERSATION_ID,
          senderUserId: TUTOR_ID,
        }),
      ).resolves.toMatchObject({ body: 'Yes, I do.', senderUserId: TUTOR_ID });
      expect(mockPrismaService.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            body: 'Yes, I do.',
            clientMessageId: null,
            conversationId: CONVERSATION_ID,
            senderUserId: TUTOR_ID,
          },
        }),
      );
    });

    it('returns 404 for a conversation that does not exist and stores nothing', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.sendMessage({
          body: 'Hello',
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
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
        service.sendMessage({ body: 'Hello', conversationId: CONVERSATION_ID, senderUserId }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
    });

    it('returns the original message when a retry reuses clientMessageId', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockRejectedValue(createDatabaseError('P2002'));
      mockPrismaService.message.findFirst.mockResolvedValue(
        storedMessage({ clientMessageId: CLIENT_MESSAGE_ID }),
      );

      await expect(
        service.sendMessage({
          body: US2_1_MESSAGE,
          clientMessageId: CLIENT_MESSAGE_ID,
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
        }),
      ).resolves.toMatchObject({ clientMessageId: CLIENT_MESSAGE_ID, id: MESSAGE_ID });
      expect(mockPrismaService.message.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientMessageId: CLIENT_MESSAGE_ID, senderUserId: STUDENT_ID },
        }),
      );
    });

    it('returns 409 when clientMessageId was already used in another conversation', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockRejectedValue(createDatabaseError('P2002'));
      mockPrismaService.message.findFirst.mockResolvedValue(
        storedMessage({
          clientMessageId: CLIENT_MESSAGE_ID,
          conversationId: OTHER_CONVERSATION_ID,
        }),
      );

      await expect(
        service.sendMessage({
          body: 'Hello',
          clientMessageId: CLIENT_MESSAGE_ID,
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      ['a duplicate error without clientMessageId', 'P2002', undefined],
      ['an unrelated database error', 'P1001', CLIENT_MESSAGE_ID],
    ])('rethrows %s', async (_label, code, clientMessageId) => {
      const error = createDatabaseError(code);
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
      mockPrismaService.message.create.mockRejectedValue(error);

      await expect(
        service.sendMessage({
          body: 'Hello',
          clientMessageId,
          conversationId: CONVERSATION_ID,
          senderUserId: STUDENT_ID,
        }),
      ).rejects.toBe(error);
    });
  });
});

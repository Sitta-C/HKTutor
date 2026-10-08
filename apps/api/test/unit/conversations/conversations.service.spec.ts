import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { encodeConversationCursor } from '@modules/conversations/conversations.cursor';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';

import type { Prisma } from '@generated/prisma/client';
import type { TestingModule } from '@nestjs/testing';

const STUDENT_ID = '6bb01222-1fce-4bc3-a69d-3d90db2fdf57';
const OTHER_STUDENT_ID = '9d3c5a1e-2b4f-4e6a-8c7d-0f1e2d3c4b5a';
const ADMIN_ID = '4a7b2c9d-1e3f-4a5b-8c6d-7e8f9a0b1c2d';
const TUTOR_ID = '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857';
const OTHER_TUTOR_ID = '5c8e2f1a-7b3d-4e9f-a0c1-d2e3f4a5b6c7';
const CONVERSATION_ID = '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f';
const OTHER_CONVERSATION_ID = '3e2d1c0b-9a8f-4e7d-b6c5-a4b3c2d1e0f9';
const MESSAGE_ID = 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69';
const US2_1_MESSAGE = 'Do you teach quadratic equations?';
const CREATED_AT = new Date('2026-09-30T08:00:00.000Z');
const SENT_AT = new Date('2026-09-30T08:05:00.000Z');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type DatabaseError = Error & { code: string };

interface OpenBody {
  participantId?: string;
  tutorId?: string;
}

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
    conversation: { create: jest.fn(), findUnique: jest.fn() },
    message: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    studentProfile: { findFirst: jest.fn() },
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
    const openAsStudent = (body: OpenBody = { tutorId: TUTOR_ID }) =>
      service.openConversation({ ...body, role: Role.STUDENT, userId: STUDENT_ID });
    const openAsTutor = (body: OpenBody = { participantId: STUDENT_ID }) =>
      service.openConversation({ ...body, role: Role.TUTOR, userId: TUTOR_ID });

    const expectNoQueries = () => {
      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.tutorProfile.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.studentProfile.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.conversation.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      mockPrismaService.user.findUnique.mockResolvedValue(activeStudent);
      mockPrismaService.tutorProfile.findFirst.mockResolvedValue(publicTutor);
      mockPrismaService.studentProfile.findFirst.mockResolvedValue({ userId: STUDENT_ID });
    });

    describe('request checks', () => {
      it.each([
        ['a student', Role.STUDENT, STUDENT_ID, { tutorId: STUDENT_ID }],
        [
          'a student using upper case',
          Role.STUDENT,
          STUDENT_ID,
          { tutorId: STUDENT_ID.toUpperCase() },
        ],
        ['a tutor', Role.TUTOR, TUTOR_ID, { participantId: TUTOR_ID }],
      ])(
        'rejects %s targeting themselves with 400 before any query',
        async (_label, role, userId, body) => {
          const error = await service
            .openConversation({ ...body, role, userId })
            .catch((caught: unknown) => caught);

          expect(error).toBeInstanceOf(BadRequestException);
          expect(error).toHaveProperty('message', 'You cannot start a conversation with yourself.');
          expectNoQueries();
        },
      );

      it.each([
        ['a student sending participantId', Role.STUDENT, STUDENT_ID, { participantId: TUTOR_ID }],
        [
          'a student sending both keys',
          Role.STUDENT,
          STUDENT_ID,
          { participantId: TUTOR_ID, tutorId: TUTOR_ID },
        ],
        ['a student sending no key', Role.STUDENT, STUDENT_ID, {}],
        ['a tutor sending tutorId', Role.TUTOR, TUTOR_ID, { tutorId: STUDENT_ID }],
        [
          'a tutor sending both keys',
          Role.TUTOR,
          TUTOR_ID,
          { participantId: STUDENT_ID, tutorId: STUDENT_ID },
        ],
        ['a tutor sending no key', Role.TUTOR, TUTOR_ID, {}],
      ])('rejects %s with 400 before any query', async (_label, role, userId, body) => {
        await expect(service.openConversation({ ...body, role, userId })).rejects.toThrow(
          BadRequestException,
        );
        expectNoQueries();
      });

      it('rejects an admin with 403 before any query', async () => {
        await expect(
          service.openConversation({ role: Role.ADMIN, tutorId: TUTOR_ID, userId: ADMIN_ID }),
        ).rejects.toThrow(ForbiddenException);
        expectNoQueries();
      });
    });

    describe('opened by a tutor', () => {
      it('creates the conversation with the student first in the pair', async () => {
        mockPrismaService.conversation.findUnique.mockResolvedValue(null);
        mockPrismaService.conversation.create.mockResolvedValue(conversationRow);

        await expect(openAsTutor()).resolves.toEqual({
          conversation: openedConversation,
          created: true,
        });
        expect(mockPrismaService.tutorProfile.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { ...publicTutorWhere, userId: TUTOR_ID } }),
        );
        expect(mockPrismaService.studentProfile.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              user: { accountStatus: AccountStatus.ACTIVE, deletedAt: null, role: Role.STUDENT },
              userId: STUDENT_ID,
            },
          }),
        );
        expect(mockPrismaService.conversation.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID } }),
        );
      });

      it('returns the existing conversation when the tutor opens it again', async () => {
        mockPrismaService.conversation.findUnique.mockResolvedValue(conversationRow);

        await expect(openAsTutor()).resolves.toEqual({
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

      it('rejects a tutor who is not verified with 403 and creates nothing', async () => {
        mockPrismaService.tutorProfile.findFirst.mockResolvedValue(null);

        const error = await openAsTutor().catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error).toHaveProperty('message', 'Only verified tutors can start conversations.');
        expect(mockPrismaService.studentProfile.findFirst).not.toHaveBeenCalled();
        expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
      });

      it('returns 404 when participantId is not an active student with a profile, such as another tutor', async () => {
        mockPrismaService.studentProfile.findFirst.mockResolvedValue(null);

        const error = await openAsTutor({ participantId: OTHER_TUTOR_ID }).catch(
          (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error).toHaveProperty('message', 'Student not found');
        expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
      });
    });

    describe('opened by a student', () => {
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
        [
          'a deleted student',
          { ...activeStudent, deletedAt: new Date('2026-09-01T00:00:00.000Z') },
        ],
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

      it('returns 404 when tutorId is not a public tutor, such as another student', async () => {
        mockPrismaService.tutorProfile.findFirst.mockResolvedValue(null);

        const error = await openAsStudent({ tutorId: OTHER_STUDENT_ID }).catch(
          (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(error).toHaveProperty('message', 'Tutor not found');
        expect(mockPrismaService.conversation.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('getMyConversations', () => {
    const listRow = (overrides: Record<string, unknown> = {}) => ({
      activityAt: SENT_AT,
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
      unreadCount: 2,
      ...overrides,
    });
    const quietRow = listRow({
      activityAt: CREATED_AT,
      id: OTHER_CONVERSATION_ID,
      lastMessageId: null,
      lastMessageSenderUserId: null,
      lastMessageSentAt: null,
      lastMessageText: null,
      unreadCount: 0,
    });

    const listQuery = (): Prisma.Sql | undefined =>
      (mockPrismaService.$queryRaw.mock.calls as unknown as Array<[Prisma.Sql]>)[0]?.[0];

    it("lists a student's conversations latest activity first with the tutor, last message and unread count", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([listRow(), quietRow]);

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
            unreadCount: 2,
          },
          {
            conversationId: OTHER_CONVERSATION_ID,
            createdAt: CREATED_AT.toISOString(),
            lastMessage: null,
            otherParticipant: { displayName: 'Anan Suksawat', userId: TUTOR_ID },
            unreadCount: 0,
          },
        ],
        nextCursor: null,
      });
      expect(listQuery()?.text).toContain('m."senderUserId" <> $1');
      expect(listQuery()?.text).toContain('m."readAt" IS NULL');
      expect(listQuery()?.text).toContain('c."studentUserId" = $2');
      expect(listQuery()?.text).toMatch(
        /ORDER BY COALESCE\(last_message\."sentAt", c\."createdAt"\) DESC, c\."id" DESC/,
      );
      expect(listQuery()?.values).toEqual([STUDENT_ID, STUDENT_ID, 21]);
    });

    it("lists a tutor's conversations with the student's nickname", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([listRow()]);

      const result = await service.getMyConversations({ role: Role.TUTOR, userId: TUTOR_ID });

      expect(result.items[0]?.otherParticipant).toEqual({
        displayName: 'Nan',
        userId: STUDENT_ID,
      });
      expect(listQuery()?.text).toContain('c."tutorUserId" = $2');
      expect(listQuery()?.values).toEqual([TUTOR_ID, TUTOR_ID, 21]);
    });

    it('returns a cursor at the last item when another page follows', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([listRow(), quietRow]);

      const result = await service.getMyConversations({
        limit: 1,
        role: Role.STUDENT,
        userId: STUDENT_ID,
      });

      expect(result.items.map((item) => item.conversationId)).toEqual([CONVERSATION_ID]);
      expect(result.nextCursor).toBe(
        encodeConversationCursor({ activityAt: SENT_AT.toISOString(), id: CONVERSATION_ID }),
      );
      expect(listQuery()?.values).toEqual([STUDENT_ID, STUDENT_ID, 2]);
    });

    it('continues after the cursor and ends with a null cursor', async () => {
      const cursor = encodeConversationCursor({
        activityAt: SENT_AT.toISOString(),
        id: CONVERSATION_ID,
      });
      mockPrismaService.$queryRaw.mockResolvedValue([quietRow]);

      const result = await service.getMyConversations({
        cursor,
        limit: 1,
        role: Role.STUDENT,
        userId: STUDENT_ID,
      });

      expect(result.items.map((item) => item.conversationId)).toEqual([OTHER_CONVERSATION_ID]);
      expect(result.nextCursor).toBeNull();
      expect(listQuery()?.text).toContain(
        '(COALESCE(last_message."sentAt", c."createdAt"), c."id") < ($3::timestamptz, $4::uuid)',
      );
      expect(listQuery()?.values).toEqual([
        STUDENT_ID,
        STUDENT_ID,
        SENT_AT.toISOString(),
        CONVERSATION_ID,
        2,
      ]);
    });

    it('rejects a cursor this list did not return with 400 without querying', async () => {
      await expect(
        service.getMyConversations({
          cursor: 'not-a-cursor',
          role: Role.STUDENT,
          userId: STUDENT_ID,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
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

  describe('getMessages', () => {
    const participants = { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID };
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, index) => from + index);
    const messageId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const sentAt = (n: number) => new Date(SENT_AT.getTime() + n * 1000);
    const historyRows = (from: number, to: number) =>
      range(from, to).map((n) =>
        storedMessage({ id: messageId(n), sentAt: sentAt(n), text: `m-${n}` }),
      );
    const findManyArgs = (): Prisma.MessageFindManyArgs | undefined =>
      (
        mockPrismaService.message.findMany.mock.calls as unknown as Array<
          [Prisma.MessageFindManyArgs]
        >
      )[0]?.[0];
    const readPage = (
      query: { afterMessageId?: string; pageSize?: number; userId?: string } = {},
    ) => service.getMessages({ conversationId: CONVERSATION_ID, userId: STUDENT_ID, ...query });

    beforeEach(() => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
    });

    it('returns the first page oldest first with the API-02 fields and the next cursor', async () => {
      mockPrismaService.message.findMany.mockResolvedValue(historyRows(1, 21));

      const page = await readPage({ pageSize: 20 });

      expect(page.items).toHaveLength(20);
      expect(page.items[0]).toEqual({
        conversationId: CONVERSATION_ID,
        messageId: messageId(1),
        readAt: null,
        senderId: STUDENT_ID,
        sentAt: sentAt(1).toISOString(),
        text: 'm-1',
      });
      expect(page).toMatchObject({ hasMore: true, nextAfterMessageId: messageId(20) });
      expect(findManyArgs()).toMatchObject({
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        take: 21,
        where: { conversationId: CONVERSATION_ID },
      });
      expect(mockPrismaService.message.findFirst).not.toHaveBeenCalled();
    });

    it('continues after the cursor message and reports the last page', async () => {
      mockPrismaService.message.findFirst.mockResolvedValue({
        id: messageId(20),
        sentAt: sentAt(20),
      });
      mockPrismaService.message.findMany.mockResolvedValue(historyRows(21, 35));

      const page = await readPage({
        afterMessageId: messageId(20),
        pageSize: 20,
        userId: TUTOR_ID,
      });

      expect(page.items.map((item) => item.text)).toEqual(range(21, 35).map((n) => `m-${n}`));
      expect(page).toMatchObject({ hasMore: false, nextAfterMessageId: messageId(35) });
      expect(mockPrismaService.message.findFirst).toHaveBeenCalledWith({
        select: { id: true, sentAt: true },
        where: { conversationId: CONVERSATION_ID, id: messageId(20) },
      });
      expect(findManyArgs()?.where).toEqual({
        OR: [{ sentAt: { gt: sentAt(20) } }, { id: { gt: messageId(20) }, sentAt: sentAt(20) }],
        conversationId: CONVERSATION_ID,
      });
    });

    it('returns an empty page after the last message and keeps the cursor for polling', async () => {
      mockPrismaService.message.findFirst.mockResolvedValue({
        id: messageId(35),
        sentAt: sentAt(35),
      });
      mockPrismaService.message.findMany.mockResolvedValue([]);

      await expect(readPage({ afterMessageId: messageId(35) })).resolves.toEqual({
        hasMore: false,
        items: [],
        nextAfterMessageId: messageId(35),
      });
    });

    it('returns a null cursor for a conversation without messages and reads 20 by default', async () => {
      mockPrismaService.message.findMany.mockResolvedValue([]);

      await expect(readPage()).resolves.toEqual({
        hasMore: false,
        items: [],
        nextAfterMessageId: null,
      });
      expect(findManyArgs()?.take).toBe(21);
    });

    it('rejects a cursor that is not a message in this conversation with 400', async () => {
      mockPrismaService.message.findFirst.mockResolvedValue(null);

      const error = await readPage({ afterMessageId: messageId(99) }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toHaveProperty(
        'message',
        'afterMessageId must be a message in this conversation.',
      );
      expect(mockPrismaService.message.findMany).not.toHaveBeenCalled();
    });

    it('returns 404 for a conversation that does not exist', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);

      await expect(readPage()).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.message.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ['another student', OTHER_STUDENT_ID],
      ['an admin', ADMIN_ID],
    ])('returns 403 to %s and reads no messages', async (_label, userId) => {
      const error = await readPage({ userId }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error).toHaveProperty('message', 'Only participants can read this conversation.');
      expect(mockPrismaService.message.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('markMessagesRead', () => {
    const participants = { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID };
    const READ_AT = new Date('2026-09-30T08:10:00.000Z');
    const readQuery = (): Prisma.Sql | undefined =>
      (mockPrismaService.$queryRaw.mock.calls as unknown as Array<[Prisma.Sql]>)[0]?.[0];
    const markRead = (input: { upToMessageId?: string; userId?: string } = {}) =>
      service.markMessagesRead({ conversationId: CONVERSATION_ID, userId: TUTOR_ID, ...input });

    beforeEach(() => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(participants);
    });

    it("marks only the other participant's unread messages, with the database clock", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ readAt: READ_AT, updatedCount: 3 }]);

      await expect(markRead()).resolves.toEqual({
        readAt: READ_AT.toISOString(),
        updatedCount: 3,
      });
      expect(readQuery()?.text).toContain('SET "readAt" = GREATEST(now(), "sentAt")');
      expect(readQuery()?.text).toContain('"senderUserId" <> $2');
      expect(readQuery()?.text).toContain('"readAt" IS NULL');
      expect(readQuery()?.text).not.toContain('("sentAt", "id") <=');
      expect(readQuery()?.values).toEqual([CONVERSATION_ID, TUTOR_ID]);
      expect(mockPrismaService.message.findFirst).not.toHaveBeenCalled();
    });

    it('marks only up to upToMessageId when it is given', async () => {
      mockPrismaService.message.findFirst.mockResolvedValue({ id: MESSAGE_ID, sentAt: SENT_AT });
      mockPrismaService.$queryRaw.mockResolvedValue([{ readAt: READ_AT, updatedCount: 1 }]);

      await expect(markRead({ upToMessageId: MESSAGE_ID })).resolves.toEqual({
        readAt: READ_AT.toISOString(),
        updatedCount: 1,
      });
      expect(mockPrismaService.message.findFirst).toHaveBeenCalledWith({
        select: { id: true, sentAt: true },
        where: { conversationId: CONVERSATION_ID, id: MESSAGE_ID },
      });
      expect(readQuery()?.text).toContain('("sentAt", "id") <= ($3::timestamptz, $4::uuid)');
      expect(readQuery()?.values).toEqual([CONVERSATION_ID, TUTOR_ID, SENT_AT, MESSAGE_ID]);
    });

    it('reports nothing marked when the messages were already read', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ readAt: null, updatedCount: 0 }]);

      await expect(markRead()).resolves.toEqual({ readAt: null, updatedCount: 0 });
    });

    it('rejects an upToMessageId outside the conversation with 400 and updates nothing', async () => {
      mockPrismaService.message.findFirst.mockResolvedValue(null);

      const error = await markRead({ upToMessageId: MESSAGE_ID }).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error).toHaveProperty(
        'message',
        'upToMessageId must be a message in this conversation.',
      );
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns 404 for a conversation that does not exist', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);

      await expect(markRead()).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });

    it.each([
      ['another student', OTHER_STUDENT_ID],
      ['an admin', ADMIN_ID],
    ])('returns 403 to %s and updates nothing', async (_label, userId) => {
      const error = await markRead({ userId }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error).toHaveProperty(
        'message',
        'Only participants can mark messages read in this conversation.',
      );
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });
});

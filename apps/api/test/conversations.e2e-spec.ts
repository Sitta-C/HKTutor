import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { ConversationsController } from '@modules/conversations/conversations.controller';
import { ConversationsService } from '@modules/conversations/conversations.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_STUDENT_ID = '30000000-0000-4000-8000-000000000002';
const CONVERSATION_ID = '40000000-0000-4000-8000-000000000001';
const MESSAGE_ID = '50000000-0000-4000-8000-000000000001';
const OTHER_MESSAGE_ID = '50000000-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-10-07T02:00:00.000Z');
const SENT_AT = new Date('2026-10-07T02:05:00.000Z');

const USER_IDS: Record<Role, string> = {
  [Role.ADMIN]: ADMIN_ID,
  [Role.STUDENT]: STUDENT_ID,
  [Role.TUTOR]: TUTOR_ID,
};

const conversationRow = {
  createdAt: CREATED_AT,
  id: CONVERSATION_ID,
  studentUserId: STUDENT_ID,
  tutorUserId: TUTOR_ID,
};

const participants = { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID };

const openedConversation = {
  conversationId: CONVERSATION_ID,
  createdAt: CREATED_AT.toISOString(),
  participants: [
    { role: Role.STUDENT, userId: STUDENT_ID },
    { role: Role.TUTOR, userId: TUTOR_ID },
  ],
};

describe('Conversation APIs (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const userFindUnique = jest.fn();
  const tutorProfileFindFirst = jest.fn();
  const studentProfileFindFirst = jest.fn();
  const conversationFindUnique = jest.fn();
  const conversationCreate = jest.fn();
  const messageCreate = jest.fn();
  const messageFindFirst = jest.fn();
  const messageFindMany = jest.fn();
  const queryRaw = jest.fn();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        ConversationsService,
        JwtAuthGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: queryRaw,
            authSession: { findUnique: authSessionFindUnique },
            conversation: { create: conversationCreate, findUnique: conversationFindUnique },
            message: {
              create: messageCreate,
              findFirst: messageFindFirst,
              findMany: messageFindMany,
            },
            studentProfile: { findFirst: studentProfileFindFirst },
            tutorProfile: { findFirst: tutorProfileFindFirst },
            user: { findUnique: userFindUnique },
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.resetAllMocks());

  describe('POST /api/v1/conversations (API-01)', () => {
    it('returns 401 without an access token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .send({ tutorId: TUTOR_ID })
        .expect(401);

      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
      expect(conversationCreate).not.toHaveBeenCalled();
    });

    it.each([
      [Role.STUDENT, { tutorId: TUTOR_ID }],
      [Role.TUTOR, { participantId: STUDENT_ID }],
    ])('opens the conversation for a %s with 201, then returns it with 200', async (role, body) => {
      authenticateAs(role);
      stubEligibleParticipants();
      conversationFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(conversationRow);
      conversationCreate.mockResolvedValue(conversationRow);

      const first = await post('/conversations').send(body).expect(201);
      const repeated = await post('/conversations').send(body).expect(200);

      expect(first.body).toEqual(openedConversation);
      expect(repeated.body).toEqual(openedConversation);
      expect(conversationCreate).toHaveBeenCalledTimes(1);
      expect(conversationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { studentUserId: STUDENT_ID, tutorUserId: TUTOR_ID } }),
      );
    });

    it.each([
      [Role.STUDENT, { tutorId: STUDENT_ID }],
      [Role.TUTOR, { participantId: TUTOR_ID }],
    ])('returns 400 to a %s targeting themselves before any lookup', async (role, body) => {
      authenticateAs(role);

      const response = await post('/conversations').send(body).expect(400);

      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        error: 'Bad Request',
        message: 'You cannot start a conversation with yourself.',
        statusCode: 400,
      });
      expect(userFindUnique).not.toHaveBeenCalled();
      expect(tutorProfileFindFirst).not.toHaveBeenCalled();
      expect(studentProfileFindFirst).not.toHaveBeenCalled();
      expect(conversationFindUnique).not.toHaveBeenCalled();
      expect(conversationCreate).not.toHaveBeenCalled();
    });

    it('returns 400 when the body key does not match the caller role', async () => {
      authenticateAs(Role.STUDENT);

      const response = await post('/conversations').send({ participantId: TUTOR_ID }).expect(400);

      expect(response.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'A student must send tutorId and no participantId.',
      });
      expect(conversationCreate).not.toHaveBeenCalled();
    });

    it('returns 403 to an admin', async () => {
      authenticateAs(Role.ADMIN);

      const response = await post('/conversations').send({ tutorId: TUTOR_ID }).expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(conversationCreate).not.toHaveBeenCalled();
    });

    it('returns 404 when the tutor is missing or not public', async () => {
      authenticateAs(Role.STUDENT);
      stubEligibleParticipants();
      tutorProfileFindFirst.mockResolvedValue(null);

      const response = await post('/conversations').send({ tutorId: TUTOR_ID }).expect(404);

      expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: 'Tutor not found' });
      expect(conversationCreate).not.toHaveBeenCalled();
    });

    it('returns 404 when a tutor targets someone who is not a student', async () => {
      authenticateAs(Role.TUTOR);
      stubEligibleParticipants();
      studentProfileFindFirst.mockResolvedValue(null);

      const response = await post('/conversations')
        .send({ participantId: OTHER_STUDENT_ID })
        .expect(404);

      expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: 'Student not found' });
      expect(conversationCreate).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/conversations/:conversationId/messages (API-02)', () => {
    const messagesPath = `/conversations/${CONVERSATION_ID}/messages`;

    it('returns 401 without an access token', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1${messagesPath}`)
        .send({ text: 'Hello' })
        .expect(401);

      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
      expect(messageCreate).not.toHaveBeenCalled();
    });

    it.each([1, 2000])(
      'stores a %i-character message with 201 and the API-02 body',
      async (length) => {
        const text = 'a'.repeat(length);
        authenticateAs(Role.STUDENT);
        conversationFindUnique.mockResolvedValue({
          studentUserId: STUDENT_ID,
          tutorUserId: TUTOR_ID,
        });
        messageCreate.mockResolvedValue({
          conversationId: CONVERSATION_ID,
          id: MESSAGE_ID,
          readAt: null,
          senderUserId: STUDENT_ID,
          sentAt: SENT_AT,
          text,
        });

        const response = await post(messagesPath).send({ text }).expect(201);

        expect(response.body).toEqual({
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          readAt: null,
          senderId: STUDENT_ID,
          sentAt: SENT_AT.toISOString(),
          text,
        });
        const createdData = (
          messageCreate.mock.calls as unknown as Array<[{ data: { senderUserId: string } }]>
        )[0]?.[0].data;
        expect(createdData).toMatchObject({ senderUserId: STUDENT_ID, text });
      },
    );

    it.each([
      ['a 2001-character text', 'a'.repeat(2001)],
      ['a blank text', '   '],
    ])('returns 400 for %s and stores nothing', async (_label, text) => {
      authenticateAs(Role.STUDENT);

      const response = await post(messagesPath).send({ text }).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
      expect(conversationFindUnique).not.toHaveBeenCalled();
      expect(messageCreate).not.toHaveBeenCalled();
    });

    it('returns 404 when the conversation does not exist', async () => {
      authenticateAs(Role.STUDENT);
      conversationFindUnique.mockResolvedValue(null);

      const response = await post(messagesPath).send({ text: 'Hello' }).expect(404);

      expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: 'Conversation not found' });
      expect(messageCreate).not.toHaveBeenCalled();
    });

    it('returns 403 to a student who is not a participant', async () => {
      authenticateAs(Role.STUDENT);
      conversationFindUnique.mockResolvedValue({
        studentUserId: OTHER_STUDENT_ID,
        tutorUserId: TUTOR_ID,
      });

      const response = await post(messagesPath).send({ text: 'Hello' }).expect(403);

      expect(response.body).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Only participants can send messages in this conversation.',
      });
      expect(messageCreate).not.toHaveBeenCalled();
    });

    it('returns 403 to an admin', async () => {
      authenticateAs(Role.ADMIN);

      const response = await post(messagesPath).send({ text: 'Hello' }).expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(conversationFindUnique).not.toHaveBeenCalled();
      expect(messageCreate).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/conversations/:conversationId/messages (S2-T19/API-02)', () => {
    const messagesPath = `/conversations/${CONVERSATION_ID}/messages`;
    const historyRow = (id: string, text: string) => ({
      conversationId: CONVERSATION_ID,
      id,
      readAt: null,
      senderUserId: TUTOR_ID,
      sentAt: SENT_AT,
      text,
    });

    it('returns 401 without an access token', async () => {
      const response = await request(app.getHttpServer()).get(`/api/v1${messagesPath}`).expect(401);

      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
      expect(messageFindMany).not.toHaveBeenCalled();
    });

    it('returns a page with nextAfterMessageId and hasMore', async () => {
      authenticateAs(Role.STUDENT);
      conversationFindUnique.mockResolvedValue(participants);
      messageFindMany.mockResolvedValue([
        historyRow(MESSAGE_ID, 'm-1'),
        historyRow(OTHER_MESSAGE_ID, 'm-2'),
      ]);

      const response = await get(`${messagesPath}?pageSize=1`).expect(200);

      expect(response.body).toEqual({
        hasMore: true,
        items: [
          {
            conversationId: CONVERSATION_ID,
            messageId: MESSAGE_ID,
            readAt: null,
            senderId: TUTOR_ID,
            sentAt: SENT_AT.toISOString(),
            text: 'm-1',
          },
        ],
        nextAfterMessageId: MESSAGE_ID,
      });
    });

    it('keeps the cursor on the empty page after the last message', async () => {
      authenticateAs(Role.STUDENT);
      conversationFindUnique.mockResolvedValue(participants);
      messageFindFirst.mockResolvedValue({ id: MESSAGE_ID, sentAt: SENT_AT });
      messageFindMany.mockResolvedValue([]);

      const response = await get(`${messagesPath}?afterMessageId=${MESSAGE_ID}`).expect(200);

      expect(response.body).toEqual({ hasMore: false, items: [], nextAfterMessageId: MESSAGE_ID });
    });

    it.each([
      ['a page size over 50', '?pageSize=51'],
      ['a page size of 0', '?pageSize=0'],
      ['a cursor that is not a UUID', '?afterMessageId=m-20'],
    ])('returns 400 for %s before any lookup', async (_label, query) => {
      authenticateAs(Role.STUDENT);

      const response = await get(`${messagesPath}${query}`).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
      expect(conversationFindUnique).not.toHaveBeenCalled();
    });

    it('returns 400 for a cursor from another conversation', async () => {
      authenticateAs(Role.STUDENT);
      conversationFindUnique.mockResolvedValue(participants);
      messageFindFirst.mockResolvedValue(null);

      const response = await get(`${messagesPath}?afterMessageId=${MESSAGE_ID}`).expect(400);

      expect(response.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'afterMessageId must be a message in this conversation.',
      });
      expect(messageFindMany).not.toHaveBeenCalled();
    });

    it('returns 403 to a student who is not a participant', async () => {
      authenticateAs(Role.STUDENT);
      conversationFindUnique.mockResolvedValue({
        studentUserId: OTHER_STUDENT_ID,
        tutorUserId: TUTOR_ID,
      });

      const response = await get(messagesPath).expect(403);

      expect(response.body).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Only participants can read this conversation.',
      });
      expect(messageFindMany).not.toHaveBeenCalled();
    });

    it('returns 404 when the conversation does not exist', async () => {
      authenticateAs(Role.TUTOR);
      conversationFindUnique.mockResolvedValue(null);

      const response = await get(messagesPath).expect(404);

      expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: 'Conversation not found' });
    });
  });

  describe('POST /api/v1/conversations/:conversationId/read (S2-T19/API-03)', () => {
    const readPath = `/conversations/${CONVERSATION_ID}/read`;
    const READ_AT = new Date('2026-10-07T02:10:00.000Z');

    it('returns 401 without an access token', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1${readPath}`)
        .send({})
        .expect(401);

      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('marks the received messages read, then reports nothing on a repeat', async () => {
      authenticateAs(Role.TUTOR);
      conversationFindUnique.mockResolvedValue(participants);
      queryRaw
        .mockResolvedValueOnce([{ readAt: READ_AT, updatedCount: 3 }])
        .mockResolvedValueOnce([{ readAt: null, updatedCount: 0 }]);

      const first = await post(readPath).send({}).expect(200);
      const repeat = await post(readPath).send({}).expect(200);

      expect(first.body).toEqual({ readAt: READ_AT.toISOString(), updatedCount: 3 });
      expect(repeat.body).toEqual({ readAt: null, updatedCount: 0 });
    });

    it.each([
      ['an upToMessageId that is not a UUID', { upToMessageId: 'm-77' }],
      ['a readAt in the body', { readAt: READ_AT.toISOString() }],
    ])('returns 400 for %s and updates nothing', async (_label, body) => {
      authenticateAs(Role.TUTOR);

      const response = await post(readPath).send(body).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('returns 403 to a student who is not a participant and updates nothing', async () => {
      authenticateAs(Role.STUDENT);
      conversationFindUnique.mockResolvedValue({
        studentUserId: OTHER_STUDENT_ID,
        tutorUserId: TUTOR_ID,
      });

      const response = await post(readPath).send({}).expect(403);

      expect(response.body).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Only participants can mark messages read in this conversation.',
      });
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('returns 403 to an admin', async () => {
      authenticateAs(Role.ADMIN);

      const response = await post(readPath).send({}).expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(conversationFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/conversations (S2-T19/API-01)', () => {
    const listRow = {
      activityAt: CREATED_AT,
      createdAt: CREATED_AT,
      id: CONVERSATION_ID,
      lastMessageId: null,
      lastMessageSenderUserId: null,
      lastMessageSentAt: null,
      lastMessageText: null,
      studentNickname: 'Nan',
      studentUserId: STUDENT_ID,
      tutorDisplayName: 'Anan',
      tutorUserId: TUTOR_ID,
      unreadCount: 0,
    };

    it('returns items with unreadCount and a null nextCursor on the last page', async () => {
      authenticateAs(Role.STUDENT);
      queryRaw.mockResolvedValue([listRow]);

      const response = await get('/conversations?limit=1').expect(200);

      expect(response.body).toEqual({
        items: [
          {
            conversationId: CONVERSATION_ID,
            createdAt: CREATED_AT.toISOString(),
            lastMessage: null,
            otherParticipant: { displayName: 'Anan', userId: TUTOR_ID },
            unreadCount: 0,
          },
        ],
        nextCursor: null,
      });
    });

    it.each([
      ['a cursor this list did not return', '?cursor=not-a-cursor'],
      ['a limit over 50', '?limit=51'],
    ])('returns 400 for %s without querying', async (_label, query) => {
      authenticateAs(Role.STUDENT);

      const response = await get(`/conversations${query}`).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('returns 403 to an admin', async () => {
      authenticateAs(Role.ADMIN);

      const response = await get('/conversations').expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });

  function get(path: string): request.Test {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', 'Bearer signed-token');
  }

  function post(path: string): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', 'Bearer signed-token');
  }

  // An active student with a profile and a verified tutor, as both open paths require.
  function stubEligibleParticipants(): void {
    userFindUnique.mockResolvedValue({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      role: Role.STUDENT,
      studentProfile: { userId: STUDENT_ID },
    });
    tutorProfileFindFirst.mockResolvedValue({ userId: TUTOR_ID });
    studentProfileFindFirst.mockResolvedValue({ userId: STUDENT_ID });
  }

  function authenticateAs(role: Role): void {
    const id = USER_IDS[role];
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: id });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: `${role.toLowerCase()}@example.com`,
        emailVerifiedAt: new Date(),
        id,
        role,
      },
      userId: id,
    });
  }
});

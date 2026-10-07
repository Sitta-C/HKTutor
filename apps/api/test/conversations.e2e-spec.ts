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
            authSession: { findUnique: authSessionFindUnique },
            conversation: { create: conversationCreate, findUnique: conversationFindUnique },
            message: { create: messageCreate },
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

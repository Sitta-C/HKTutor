import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { API_GLOBAL_PREFIX, configureApplication } from '@app/app.setup';
import { Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import { RolesGuard } from '@modules/auth/roles.guard';
import { ConversationsController } from '@modules/conversations/conversations.controller';
import { ConversationsService } from '@modules/conversations/conversations.service';

import type { AuthenticatedRequest, AuthenticatedUser } from '@modules/auth/auth.guard';
import type { ExecutionContext, INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

const STUDENT_ID = '6bb01222-1fce-4bc3-a69d-3d90db2fdf57';
const OTHER_STUDENT_ID = '9d3c5a1e-2b4f-4e6a-8c7d-0f1e2d3c4b5a';
const TUTOR_ID = '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857';
const ADMIN_ID = '4a7b2c9d-1e3f-4a5b-8c6d-7e8f9a0b1c2d';
const CONVERSATION_ID = '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f';
const MESSAGE_ID = 'b7e4c1a2-5f6d-4e8b-9a0c-3d2f1e4b5a69';
const CLIENT_MESSAGE_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const US2_1_MESSAGE = 'Do you teach quadratic equations?';

const USER_IDS: Record<Role, string> = {
  [Role.ADMIN]: ADMIN_ID,
  [Role.STUDENT]: STUDENT_ID,
  [Role.TUTOR]: TUTOR_ID,
};

const signedInAs = (role: Role): AuthenticatedUser => ({
  email: `${role.toLowerCase()}@example.com`,
  id: USER_IDS[role],
  role,
  sessionId: 'session-id',
});

const conversationSummary = {
  createdAt: '2026-09-30T08:00:00.000Z',
  id: CONVERSATION_ID,
  lastMessage: null,
  otherParticipant: { displayName: 'Anan Suksawat', id: TUTOR_ID },
};

const storedMessage = {
  clientMessageId: CLIENT_MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  id: MESSAGE_ID,
  readAt: null,
  senderUserId: STUDENT_ID,
  sentAt: '2026-09-30T08:05:00.000Z',
  text: US2_1_MESSAGE,
};

describe('ConversationsController', () => {
  it('signs in the caller and checks roles on every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ConversationsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });
});

describe('conversation routes', () => {
  let app: INestApplication<App>;
  let currentUser: AuthenticatedUser;
  const getMyConversations = jest.fn();
  const openConversation = jest.fn();
  const sendMessage = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        RolesGuard,
        {
          provide: ConversationsService,
          useValue: { getMyConversations, openConversation, sendMessage },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
          request.auth = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    currentUser = signedInAs(Role.STUDENT);
  });

  describe('POST /conversations', () => {
    it('returns 201 for a new conversation and takes the student from the session', async () => {
      openConversation.mockResolvedValue({ conversation: conversationSummary, created: true });

      await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .send({ tutorId: TUTOR_ID })
        .expect(201)
        .expect(conversationSummary);

      expect(openConversation).toHaveBeenCalledWith({
        studentUserId: STUDENT_ID,
        tutorId: TUTOR_ID,
      });
    });

    it('returns 200 when the conversation already exists', async () => {
      openConversation.mockResolvedValue({ conversation: conversationSummary, created: false });

      await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .send({ tutorId: TUTOR_ID })
        .expect(200)
        .expect(conversationSummary);
    });

    it.each([Role.TUTOR, Role.ADMIN])(
      'rejects a %s with 403 before calling the service',
      async (role) => {
        currentUser = signedInAs(role);

        await request(app.getHttpServer())
          .post('/api/v1/conversations')
          .send({ tutorId: TUTOR_ID })
          .expect(403);

        expect(openConversation).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['a malformed tutorId', { tutorId: 'not-a-uuid' }],
      ['a studentUserId in the body', { studentUserId: OTHER_STUDENT_ID, tutorId: TUTOR_ID }],
    ])('rejects %s with 400 before calling the service', async (_label, payload) => {
      await request(app.getHttpServer()).post('/api/v1/conversations').send(payload).expect(400);

      expect(openConversation).not.toHaveBeenCalled();
    });
  });

  describe('GET /conversations', () => {
    it('lists the session user’s conversations with parsed paging', async () => {
      currentUser = signedInAs(Role.TUTOR);
      getMyConversations.mockResolvedValue({ items: [conversationSummary], total: 1 });

      await request(app.getHttpServer())
        .get('/api/v1/conversations?page=2&pageSize=5')
        .expect(200)
        .expect({ items: [conversationSummary], total: 1 });

      expect(getMyConversations).toHaveBeenCalledWith({
        page: 2,
        pageSize: 5,
        role: Role.TUTOR,
        userId: TUTOR_ID,
      });
    });

    it('rejects an admin with 403 before calling the service', async () => {
      currentUser = signedInAs(Role.ADMIN);

      await request(app.getHttpServer()).get('/api/v1/conversations').expect(403);

      expect(getMyConversations).not.toHaveBeenCalled();
    });
  });

  describe('POST /conversations/:conversationId/messages', () => {
    const messagesPath = `/api/v1/conversations/${CONVERSATION_ID}/messages`;

    it('stores the trimmed message from the session user and returns 201', async () => {
      sendMessage.mockResolvedValue(storedMessage);

      await request(app.getHttpServer())
        .post(messagesPath)
        .send({ clientMessageId: CLIENT_MESSAGE_ID, text: `  ${US2_1_MESSAGE}  ` })
        .expect(201)
        .expect(storedMessage);

      expect(sendMessage).toHaveBeenCalledWith({
        clientMessageId: CLIENT_MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        senderUserId: STUDENT_ID,
        text: US2_1_MESSAGE,
      });
    });

    it('lets a tutor reply', async () => {
      currentUser = signedInAs(Role.TUTOR);
      sendMessage.mockResolvedValue({ ...storedMessage, senderUserId: TUTOR_ID });

      await request(app.getHttpServer())
        .post(messagesPath)
        .send({ text: 'Yes, I do.' })
        .expect(201);

      expect(sendMessage).toHaveBeenCalledWith({
        conversationId: CONVERSATION_ID,
        senderUserId: TUTOR_ID,
        text: 'Yes, I do.',
      });
    });

    it.each([
      ['an empty text', { text: '' }],
      ['a whitespace-only text', { text: '   \n\t ' }],
      ['a text over 2000 characters', { text: 'a'.repeat(2001) }],
      ['a malformed clientMessageId', { clientMessageId: 'retry-1', text: 'Hello' }],
      ['a senderUserId in the body', { senderUserId: OTHER_STUDENT_ID, text: 'Hello' }],
    ])('rejects %s with 400 and stores nothing', async (_label, payload) => {
      await request(app.getHttpServer()).post(messagesPath).send(payload).expect(400);

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a malformed conversationId with 400 and stores nothing', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/conversations/not-a-uuid/messages')
        .send({ text: 'Hello' })
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'INVALID_UUID',
        message: 'conversationId must be a valid UUID',
      });
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects an admin with 403 and stores nothing', async () => {
      currentUser = signedInAs(Role.ADMIN);

      await request(app.getHttpServer()).post(messagesPath).send({ text: 'Hello' }).expect(403);

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});

describe('ConversationsController OpenAPI contract', () => {
  const previousDatabaseUrl = process.env['DATABASE_URL'];
  let app: INestApplication | undefined;
  let document: OpenAPIObject;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = 'postgresql://user:password@example.test:5432/hktutor';
    const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>('@app/app.module');

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $transaction: jest.fn(), teachingListing: { findMany: jest.fn() } })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Test')
        .setVersion('1')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, JWT_BEARER_AUTH)
        .build(),
    );
  });

  afterAll(async () => {
    await app?.close();

    if (previousDatabaseUrl === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = previousDatabaseUrl;
    }
  });

  it('publishes the open-conversation contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/conversations`]?.post;

    expect(operation?.summary).toBe('Open a conversation with a tutor');
    for (const status of ['200', '201', '400', '401', '403', '404']) {
      expect(operation?.responses[status]).toBeDefined();
    }
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
  });

  it('publishes the list-conversations contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/conversations`]?.get;
    const parameterNames = (operation?.parameters as Array<{ name?: string }> | undefined)?.map(
      (parameter) => parameter.name,
    );

    expect(operation?.summary).toBe('List my conversations');
    expect(parameterNames).toEqual(expect.arrayContaining(['page', 'pageSize']));
    for (const status of ['200', '400', '401', '403']) {
      expect(operation?.responses[status]).toBeDefined();
    }
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
  });

  it('publishes the send-message contract', () => {
    const operation =
      document.paths[`/${API_GLOBAL_PREFIX}/conversations/{conversationId}/messages`]?.post;

    expect(operation?.summary).toBe('Send a message in a conversation');
    for (const status of ['201', '400', '401', '403', '404', '409']) {
      expect(operation?.responses[status]).toBeDefined();
    }
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
  });

  it('documents the message text limits and keeps the sender out of the request body', () => {
    const schema = document.components?.schemas?.['SendMessageDto'] as
      | {
          properties?: Record<string, { maxLength?: number; minLength?: number }>;
          required?: string[];
        }
      | undefined;

    expect(schema?.properties?.['text']).toMatchObject({ maxLength: 2000, minLength: 1 });
    expect(schema?.properties?.['clientMessageId']).toBeDefined();
    expect(schema?.properties?.['senderUserId']).toBeUndefined();
    expect(schema?.required).toEqual(['text']);
  });
});

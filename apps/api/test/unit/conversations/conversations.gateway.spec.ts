import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { Server } from 'socket.io';

import { AuthConfigService } from '@config/auth.config';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { SessionRevocations } from '@modules/auth/session-revocations';
import { ConversationEvents } from '@modules/conversations/conversation-events';
import { ConversationsGateway } from '@modules/conversations/conversations.gateway';
import { ConversationsService } from '@modules/conversations/conversations.service';
import {
  conversationRecipientRoom,
  parseConversationRoom,
} from '@modules/conversations/conversations.socket-contract';

import type { AccessSession } from '@modules/auth/access-session';
import type { ConversationEvent } from '@modules/conversations/conversation-events';
import type {
  ChatClientEvents,
  ChatServerEvents,
  ChatSocket,
} from '@modules/conversations/conversations.socket-contract';

const CONVERSATION = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('ConversationsGateway boundaries', () => {
  it('validates and canonicalizes the conversation UUID so case cannot split a room', () => {
    expect(parseConversationRoom({ conversationId: CONVERSATION })).toEqual({
      conversationId: CONVERSATION.toLowerCase(),
    });
    expect(conversationRecipientRoom(CONVERSATION, USER.toUpperCase())).toBe(
      `conversation:${CONVERSATION.toLowerCase()}:user:${USER}`,
    );
  });

  it.each([
    undefined,
    null,
    [],
    {},
    'forged',
    { conversationId: 'bad' },
    { conversationId: CONVERSATION, roomName: 'forged' },
    { conversationId: CONVERSATION, userId: USER },
    { conversationId: CONVERSATION, role: 'ADMIN' },
  ])('rejects invalid or authority-bearing room input %#', (payload) => {
    expect(() => parseConversationRoom(payload)).toThrow(BadRequestException);
  });

  it('enforces the configured origin on WebSocket Upgrade as well as HTTP CORS', () => {
    const metadata: unknown = Reflect.getMetadata(GATEWAY_OPTIONS, ConversationsGateway);
    expect(metadata).toMatchObject({
      path: '/api/v1/socket.io',
      namespace: '/chat',
      maxHttpBufferSize: 8192,
    });
  });

  it('removes revocation listeners and never dispatches to an unjoined recipient', async () => {
    const revocations = new SessionRevocations();
    const subscribed = jest.spyOn(revocations, 'subscribe');
    const module = await Test.createTestingModule({
      providers: [
        ConversationEvents,
        ConversationsGateway,
        ConversationsService,
        JwtTokenService,
        { provide: PrismaService, useValue: {} },
        { provide: SessionRevocations, useValue: revocations },
        { provide: AuthConfigService, useValue: new AuthConfigService(new ConfigService()) },
      ],
    }).compile();
    const gateway = module.get(ConversationsGateway);
    const server = new Server<
      ChatClientEvents,
      ChatServerEvents,
      Record<string, never>,
      { access?: AccessSession }
    >();
    gateway.afterInit(server.of('/chat'));
    const dispatch = jest.fn();
    await gateway.forAuthorizedRecipient(CONVERSATION, USER, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(subscribed).toHaveBeenCalledTimes(1);
    gateway.onModuleDestroy();
    expect(() => revocations.revoke({ userId: USER })).not.toThrow();
    await module.close();
  });
});

describe('ConversationsGateway event delivery (S3-T02)', () => {
  const RECIPIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const created: ConversationEvent = {
    type: 'message_created',
    recipientUserId: RECIPIENT,
    payload: {
      messageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      conversationId: CONVERSATION.toLowerCase(),
      senderId: USER,
      text: 'synthetic',
      sentAt: '2026-11-10T11:00:00.000Z',
      readAt: null,
    },
  };
  const read: ConversationEvent = {
    type: 'messages_read',
    recipientUserId: RECIPIENT,
    payload: {
      conversationId: CONVERSATION.toLowerCase(),
      messageIds: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
      readByUserId: USER,
      readAt: '2026-11-10T11:05:00.000Z',
    },
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  async function startGateway() {
    const module = await Test.createTestingModule({
      providers: [
        ConversationEvents,
        ConversationsGateway,
        ConversationsService,
        JwtTokenService,
        SessionRevocations,
        { provide: PrismaService, useValue: {} },
        { provide: AuthConfigService, useValue: new AuthConfigService(new ConfigService()) },
      ],
    }).compile();
    const gateway = module.get(ConversationsGateway);
    const events = module.get(ConversationEvents);
    gateway.afterInit(
      new Server<
        ChatClientEvents,
        ChatServerEvents,
        Record<string, never>,
        { access?: AccessSession }
      >().of('/chat'),
    );
    return { module, gateway, events };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('emits each event only through the recipient check, and stops after shutdown', async () => {
    const { module, gateway, events } = await startGateway();
    const socket = { emit: jest.fn() };
    const recipientCheck = jest
      .spyOn(gateway, 'forAuthorizedRecipient')
      .mockImplementation((_conversationId, _recipientUserId, dispatch) => {
        dispatch(socket as unknown as ChatSocket);
        return Promise.resolve();
      });

    events.publish(created);
    events.publish(read);
    await settle();

    expect(
      recipientCheck.mock.calls.map(([conversationId, recipientUserId]) => [
        conversationId,
        recipientUserId,
      ]),
    ).toEqual([
      [created.payload.conversationId, RECIPIENT],
      [read.payload.conversationId, RECIPIENT],
    ]);
    expect(socket.emit.mock.calls).toEqual([
      ['message_created', created.payload],
      ['messages_read', read.payload],
    ]);

    gateway.onModuleDestroy();
    events.publish(created);
    await settle();
    expect(recipientCheck).toHaveBeenCalledTimes(2);
    await module.close();
  });

  it('logs only the event type and error class when delivery fails', async () => {
    const { module, gateway, events } = await startGateway();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest
      .spyOn(gateway, 'forAuthorizedRecipient')
      .mockRejectedValue(new TypeError(`leaked ${created.payload.text}`));

    expect(() => events.publish(created)).not.toThrow();
    await settle();

    expect(warn).toHaveBeenCalledWith('Chat message_created delivery failed (TypeError)');
    await module.close();
  });
});

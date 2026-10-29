import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';
import { Server } from 'socket.io';

import { AuthConfigService } from '@config/auth.config';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { SessionRevocations } from '@modules/auth/session-revocations';
import { ConversationsGateway } from '@modules/conversations/conversations.gateway';
import { ConversationsService } from '@modules/conversations/conversations.service';
import {
  conversationRecipientRoom,
  parseConversationRoom,
} from '@modules/conversations/conversations.socket-contract';

import type { AccessSession } from '@modules/auth/access-session';
import type {
  ChatClientEvents,
  ChatServerEvents,
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

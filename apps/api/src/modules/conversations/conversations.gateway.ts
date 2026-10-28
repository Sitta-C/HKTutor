import { HttpException, UnauthorizedException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { verifyAccessSession } from '@modules/auth/access-session';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { SessionRevocations } from '@modules/auth/session-revocations';
import { ConversationsService } from '@modules/conversations/conversations.service';
import {
  CHAT_MAX_CONNECTIONS_PER_USER,
  CHAT_MAX_ROOMS,
  CHAT_NAMESPACE,
  CHAT_RATE_LIMIT,
  CHAT_RATE_WINDOW_MS,
  CHAT_SOCKET_PATH,
  conversationRecipientRoom,
  parseConversationRoom,
} from '@modules/conversations/conversations.socket-contract';

import type { AccessSession } from '@modules/auth/access-session';
import type {
  ChatError,
  ChatNamespace,
  ChatSocket,
  ConversationRoomAck,
} from '@modules/conversations/conversations.socket-contract';
import type { OnModuleDestroy } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';

interface Connection {
  socket: ChatSocket;
  token: string;
  access: AccessSession;
  expiry: ReturnType<typeof setTimeout>;
  operations: Promise<unknown>;
  windowStart: number;
  attempts: number;
  pending: number;
  rechecking: boolean;
}

function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || origin === (process.env['WEB_ORIGIN'] ?? 'http://localhost:3000');
}

@WebSocketGateway({
  namespace: CHAT_NAMESPACE,
  path: CHAT_SOCKET_PATH,
  serveClient: false,
  maxHttpBufferSize: 8_192,
  cors: { origin: (origin, done) => done(null, originAllowed(origin)), credentials: true },
  // CORS alone does not protect WebSocket Upgrade.
  allowRequest: (
    request: IncomingMessage,
    done: (error: string | null, allowed: boolean) => void,
  ) => done(null, originAllowed(request.headers.origin)),
})
export class ConversationsGateway
  implements
    OnGatewayInit<ChatNamespace>,
    OnGatewayConnection<ChatSocket>,
    OnGatewayDisconnect<ChatSocket>,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: ChatNamespace;

  private readonly connections = new Map<string, Connection>();
  private readonly handshakes = new Map<string, { start: number; count: number }>();
  private unsubscribe?: () => void;
  private recheck?: ReturnType<typeof setInterval>;

  constructor(
    private readonly jwtTokens: JwtTokenService,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly revocations: SessionRevocations,
  ) {}

  afterInit(server: ChatNamespace): void {
    this.unsubscribe = this.revocations.subscribe(({ userId, sessionId }) => {
      for (const connection of this.connections.values()) {
        if (
          connection.access.user.id === userId &&
          (sessionId === undefined || connection.access.user.sessionId === sessionId)
        ) {
          this.disconnect(connection);
        }
      }
    });
    server.use((socket: ChatSocket, next) => {
      void this.authenticateConnection(socket).then(
        () => next(),
        (error: unknown) => {
          const data = socketError(error);
          next(Object.assign(new Error(data.message), { data: { code: data.code } }));
        },
      );
    });
    // Also clear idle rooms after out-of-process account/session changes. Every dispatch below
    // checks the database independently, so this interval is not a delivery authorization cache.
    this.recheck = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (!connection.rechecking) {
          connection.rechecking = true;
          void this.authorize(connection)
            .catch(() => this.disconnect(connection))
            .finally(() => {
              connection.rechecking = false;
            });
        }
      }
      for (const [userId, window] of this.handshakes) {
        if (Date.now() - window.start >= CHAT_RATE_WINDOW_MS) {
          this.handshakes.delete(userId);
        }
      }
    }, 5_000);
    this.recheck.unref();
  }

  handleConnection(socket: ChatSocket): void {
    if (!this.connections.has(socket.id)) {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: ChatSocket): void {
    const connection = this.connections.get(socket.id);
    if (connection) {
      clearTimeout(connection.expiry);
      this.connections.delete(socket.id);
    }
    delete socket.data.access;
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    clearInterval(this.recheck);
    for (const connection of this.connections.values()) {
      this.disconnect(connection);
    }
  }

  @SubscribeMessage('conversation_join')
  join(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<ConversationRoomAck> {
    return this.changeRoom(socket, payload, true);
  }

  @SubscribeMessage('conversation_leave')
  leave(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<ConversationRoomAck> {
    return this.changeRoom(socket, payload, false);
  }

  /** T02 delivery boundary: validate each receiving tab immediately before its protected emit. */
  async forAuthorizedRecipient(
    conversationId: string,
    recipientUserId: string,
    dispatch: (socket: ChatSocket) => void,
  ): Promise<void> {
    const room = conversationRecipientRoom(conversationId, recipientUserId);
    for (const connection of this.connections.values()) {
      if (connection.access.user.id !== recipientUserId || !connection.socket.rooms.has(room)) {
        continue;
      }
      try {
        await this.authorize(connection);
        await this.conversations.assertParticipant(conversationId, connection.access.user.id);
        if (this.isCurrent(connection) && connection.socket.rooms.has(room)) {
          dispatch(connection.socket);
        }
      } catch {
        this.disconnect(connection);
      }
    }
  }

  private async authenticateConnection(socket: ChatSocket): Promise<void> {
    const auth: unknown = socket.handshake.auth;
    if (
      typeof auth !== 'object' ||
      auth === null ||
      Array.isArray(auth) ||
      Object.keys(auth).length !== 1 ||
      !('accessToken' in auth) ||
      typeof auth.accessToken !== 'string' ||
      auth.accessToken.length > 4_096 ||
      ['accessToken', 'token', 'userId', 'role'].some((key) => key in socket.handshake.query)
    ) {
      throw new UnauthorizedException('Invalid authentication');
    }
    const access = await verifyAccessSession(auth.accessToken, this.jwtTokens, this.prisma, true);
    const now = Date.now();
    // Counted per verified user: every browser behind a proxy shares one peer address.
    const window = this.handshakes.get(access.user.id);
    if (!window || now - window.start >= CHAT_RATE_WINDOW_MS) {
      this.handshakes.set(access.user.id, { start: now, count: 1 });
    } else if (++window.count > CHAT_RATE_LIMIT) {
      throw new HttpException('Chat rate limit exceeded', 429);
    }
    if (access.expiresAt <= Date.now() || socket.conn.readyState !== 'open') {
      throw new UnauthorizedException('Invalid authentication');
    }
    const count = [...this.connections.values()].filter(
      (item) => item.access.user.id === access.user.id,
    ).length;
    if (count >= CHAT_MAX_CONNECTIONS_PER_USER) {
      throw new HttpException('Chat connection limit exceeded', 429);
    }
    const connection: Connection = {
      socket,
      token: auth.accessToken,
      access,
      operations: Promise.resolve(),
      windowStart: now,
      attempts: 0,
      pending: 0,
      rechecking: false,
      expiry: setTimeout(
        () => this.expire(socket.id),
        Math.min(Math.max(0, access.expiresAt - Date.now()), 2_147_483_647),
      ),
    };
    connection.expiry.unref();
    socket.data.access = access;
    this.connections.set(socket.id, connection);
    // A client may abort while the asynchronous middleware is reading its session.
    socket.conn.once('close', () => this.handleDisconnect(socket));
  }

  private expire(socketId: string): void {
    const connection = this.connections.get(socketId);
    if (connection) {
      const remaining = connection.access.expiresAt - Date.now();
      if (remaining > 0) {
        connection.expiry = setTimeout(
          () => this.expire(socketId),
          Math.min(remaining, 2_147_483_647),
        );
        connection.expiry.unref();
      } else {
        this.disconnect(connection);
      }
    }
  }

  private disconnect(connection: Connection, afterAcknowledgement = false): void {
    this.handleDisconnect(connection.socket);
    if (afterAcknowledgement) {
      setImmediate(() => connection.socket.disconnect(true));
    } else {
      connection.socket.disconnect(true);
    }
  }

  private isCurrent(connection: Connection): boolean {
    return (
      this.connections.get(connection.socket.id) === connection &&
      connection.socket.connected &&
      Date.now() < connection.access.expiresAt
    );
  }

  private async authorize(connection: Connection): Promise<void> {
    if (!this.isCurrent(connection)) {
      throw new UnauthorizedException('Invalid authentication');
    }
    const access = await verifyAccessSession(connection.token, this.jwtTokens, this.prisma, true);
    if (!this.isCurrent(connection) || access.expiresAt <= Date.now()) {
      throw new UnauthorizedException('Invalid authentication');
    }
  }

  private changeRoom(
    socket: ChatSocket,
    payload: unknown,
    joining: boolean,
  ): Promise<ConversationRoomAck> {
    const connection = this.connections.get(socket.id);
    if (!connection) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Chat access denied' },
      });
    }
    if (Date.now() - connection.windowStart >= CHAT_RATE_WINDOW_MS) {
      connection.windowStart = Date.now();
      connection.attempts = 0;
    }
    if (++connection.attempts > CHAT_RATE_LIMIT || connection.pending >= CHAT_RATE_LIMIT) {
      this.disconnect(connection, true);
      return Promise.resolve({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Chat rate limit exceeded' },
      });
    }
    connection.pending++;
    // Serialize room mutations so a slow join cannot undo a later leave.
    const operation = connection.operations.then(async (): Promise<ConversationRoomAck> => {
      let sessionVerified = false;
      try {
        await this.authorize(connection);
        sessionVerified = true;
        const { conversationId } = parseConversationRoom(payload);
        await this.conversations.assertParticipant(conversationId, connection.access.user.id);
        if (!this.isCurrent(connection)) {
          throw new UnauthorizedException('Invalid authentication');
        }
        const room = conversationRecipientRoom(conversationId, connection.access.user.id);
        if (joining) {
          if (!socket.rooms.has(room) && socket.rooms.size - 1 >= CHAT_MAX_ROOMS) {
            throw new HttpException('Chat room limit exceeded', 429);
          }
          await socket.join(room);
          if (!this.isCurrent(connection)) {
            await socket.leave(room);
            throw new UnauthorizedException('Invalid authentication');
          }
        } else {
          await socket.leave(room);
        }
        return { ok: true, conversationId };
      } catch (error) {
        const result = socketError(error);
        // A failed session/account check ends the socket; a denied conversation fails only this event.
        const conversationDenied = sessionVerified && result.code === 'FORBIDDEN';
        if (
          !conversationDenied &&
          (result.code === 'UNAUTHENTICATED' ||
            result.code === 'FORBIDDEN' ||
            result.code === 'INTERNAL_ERROR')
        ) {
          this.disconnect(connection, true);
        }
        return { ok: false, error: result };
      } finally {
        connection.pending--;
      }
    });
    connection.operations = operation;
    return operation;
  }
}

function socketError(error: unknown): ChatError {
  const status = error instanceof HttpException ? error.getStatus() : 500;
  switch (status) {
    case 400:
      return { code: 'VALIDATION_FAILED', message: 'Invalid conversation payload' };
    case 401:
      return { code: 'UNAUTHENTICATED', message: 'Chat authentication required' };
    case 403:
      return { code: 'FORBIDDEN', message: 'Conversation access denied' };
    case 404:
      return { code: 'NOT_FOUND', message: 'Conversation not found' };
    case 429:
      return { code: 'RATE_LIMITED', message: 'Chat limit exceeded' };
    default:
      return { code: 'INTERNAL_ERROR', message: 'Chat unavailable' };
  }
}

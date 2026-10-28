import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import { Duplex } from 'node:stream';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Fetch, NodeWebSocket } from 'engine.io-client';
import * as jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { AuthService } from '@modules/auth/auth.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { PasswordService } from '@modules/auth/password.service';
import { SessionRevocations } from '@modules/auth/session-revocations';
import { ConversationsGateway } from '@modules/conversations/conversations.gateway';
import { ConversationsService } from '@modules/conversations/conversations.service';
import {
  CHAT_MAX_CONNECTIONS_PER_USER,
  CHAT_MAX_ROOMS,
  CHAT_RATE_LIMIT,
  CHAT_SOCKET_PATH,
  conversationRecipientRoom,
} from '@modules/conversations/conversations.socket-contract';

import type { ChatSocket } from '@modules/conversations/conversations.socket-contract';
import type { INestApplication } from '@nestjs/common';
import type { ChildProcess } from 'node:child_process';
import type { Socket } from 'socket.io-client';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const TUTOR = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MISSING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'http://localhost:3000';
const SECRET = 's3-t01-synthetic-access-secret-at-least-32-characters';
const config = new AuthConfigService(
  new ConfigService({
    JWT_ACCESS_SECRET: SECRET,
    JWT_REFRESH_SECRET: 's3-t01-synthetic-refresh-secret-at-least-32-characters',
  }),
);

function activeSession(userId = STUDENT, role: Role = Role.STUDENT) {
  return {
    id: `${SESSION}-${userId}`,
    userId,
    revokedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: userId,
      role,
      email: 'synthetic@example.invalid',
      accountStatus: AccountStatus.ACTIVE as AccountStatus,
      deletedAt: null as Date | null,
      emailVerifiedAt: new Date() as Date | null,
      consentAcceptedAt: new Date() as Date | null,
      policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
    },
  };
}

describe('S3-T01 real Socket.IO transport, JWT and room authorization (mocked persistence)', () => {
  let app: INestApplication;
  let gateway: ConversationsGateway;
  let tokens: JwtTokenService;
  let authService: AuthService;
  let revocations: SessionRevocations;
  let url: string;
  let sessions: Map<string, ReturnType<typeof activeSession>>;
  const clients: Socket[] = [];
  const db = {
    authSession: { findUnique: jest.fn(), updateMany: jest.fn() },
    conversation: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    sessions = new Map();
    process.env['WEB_ORIGIN'] = ORIGIN;
    db.authSession.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(sessions.get(where.id) ?? null),
    );
    db.authSession.updateMany.mockImplementation(({ where }: { where: { id: string } }) => {
      const session = sessions.get(where.id);
      if (session) {
        session.revokedAt = new Date();
      }
      return Promise.resolve({ count: session ? 1 : 0 });
    });
    db.conversation.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === MISSING
          ? null
          : { studentUserId: where.id === FOREIGN ? OTHER : STUDENT, tutorUserId: TUTOR },
      ),
    );
    const module = await Test.createTestingModule({
      providers: [
        ConversationsGateway,
        ConversationsService,
        JwtTokenService,
        SessionRevocations,
        AuthService,
        { provide: PrismaService, useValue: db },
        { provide: AuthConfigService, useValue: config },
        { provide: PasswordService, useValue: {} },
        { provide: EmailService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    gateway = module.get(ConversationsGateway);
    tokens = module.get(JwtTokenService);
    authService = module.get(AuthService);
    revocations = module.get(SessionRevocations);
    url = await app.getUrl();
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    await app.close();
  });

  function access(userId = STUDENT, role: Role = Role.STUDENT): string {
    const session = activeSession(userId, role);
    sessions.set(session.id, session);
    return tokens.signAccessToken(userId, session.id, role);
  }

  function client(
    auth: Record<string, unknown>,
    target = url,
    transport: 'websocket' | 'polling' = 'websocket',
    origin = ORIGIN,
  ): Socket {
    const socket = io(`${target}/chat`, {
      path: CHAT_SOCKET_PATH,
      auth,
      transports: [transport === 'polling' ? Fetch : NodeWebSocket],
      extraHeaders: { Origin: origin },
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      timeout: 2_000,
    });
    clients.push(socket);
    return socket;
  }

  async function connect(socket: Socket): Promise<void> {
    const connected = once(socket, 'connect');
    socket.connect();
    await connected;
  }

  function serverSocket(socket: Socket): ChatSocket {
    const found = socket.id ? gateway.server.sockets.get(socket.id) : undefined;
    if (!found) {
      throw new Error('Expected a connected server socket');
    }
    return found;
  }

  async function event(
    socket: Socket,
    name: 'conversation_join' | 'conversation_leave',
    payload: unknown = { conversationId: CONVERSATION },
  ): Promise<unknown> {
    const reply: unknown = await socket.timeout(2_000).emitWithAck(name, payload);
    return reply;
  }

  it.each([Role.STUDENT, Role.TUTOR])(
    'accepts %s without automatically joining a conversation',
    async (role) => {
      const socket = client({ accessToken: access(role === Role.STUDENT ? STUDENT : TUTOR, role) });
      await connect(socket);
      expect(serverSocket(socket).rooms).toEqual(new Set([socket.id]));
      const dispatch = jest.fn();
      await gateway.forAuthorizedRecipient(CONVERSATION, STUDENT, dispatch);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    'missing',
    'expired',
    'signature',
    'issuer',
    'audience',
    'refresh',
    'query',
    'identity',
    'huge',
  ])('rejects %s credentials before connection', async (kind) => {
    const valid = access();
    const auth: Record<string, unknown> =
      kind === 'missing' || kind === 'query' ? {} : { accessToken: valid };
    if (['expired', 'signature', 'issuer', 'audience'].includes(kind)) {
      auth['accessToken'] = jwt.sign(
        { sub: STUDENT, sid: `${SESSION}-${STUDENT}`, jti: 'synthetic', type: 'access' },
        kind === 'signature' ? 'wrong-test-secret' : SECRET,
        {
          issuer: kind === 'issuer' ? 'wrong' : config.issuer,
          audience: kind === 'audience' ? 'wrong' : config.audience,
          expiresIn: kind === 'expired' ? -1 : 60,
        },
      );
    }
    if (kind === 'refresh')
      auth['accessToken'] = tokens.signRefreshToken(STUDENT, `${SESSION}-${STUDENT}`, Role.STUDENT);
    if (kind === 'identity') auth['userId'] = OTHER;
    if (kind === 'huge') auth['accessToken'] = 'x'.repeat(4_097);
    const socket = client(auth);
    if (kind === 'query') socket.io.opts.query = { accessToken: valid };
    const failed = once(socket, 'connect_error');
    socket.connect();
    const errors: unknown[] = await failed;
    const error = errors[0];
    expect(error).toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
    expect(gateway.server.sockets.size).toBe(0);
    expect(db.conversation.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    'revoked',
    'expired-session',
    'suspended',
    'deleted',
    'unverified',
    'admin',
    'old-consent',
    'no-consent',
  ])('rejects %s current session/account', async (kind) => {
    const token = access();
    const session = sessions.get(`${SESSION}-${STUDENT}`);
    if (!session) throw new Error('Missing fixture');
    if (kind === 'revoked') session.revokedAt = new Date();
    if (kind === 'expired-session') session.expiresAt = new Date(0);
    if (kind === 'suspended') session.user.accountStatus = AccountStatus.SUSPENDED;
    if (kind === 'deleted') session.user.deletedAt = new Date();
    if (kind === 'unverified') session.user.emailVerifiedAt = null;
    if (kind === 'admin') session.user.role = Role.ADMIN;
    if (kind === 'old-consent') session.user.policyVersion = 'old';
    if (kind === 'no-consent') session.user.consentAcceptedAt = null;
    const socket = client({ accessToken: token });
    const failed = once(socket, 'connect_error');
    socket.connect();
    const errors: unknown[] = await failed;
    const error = errors[0];
    expect(error).toMatchObject({
      data: {
        code: ['revoked', 'expired-session'].includes(kind) ? 'UNAUTHENTICATED' : 'FORBIDDEN',
      },
    });
    expect(gateway.server.sockets.size).toBe(0);
  });

  it.each(['websocket', 'polling'] as const)('rejects a wrong Origin for %s', async (transport) => {
    const socket = client(
      { accessToken: access() },
      url,
      transport,
      'https://other.example.invalid',
    );
    const failed = once(socket, 'connect_error');
    socket.connect();
    await failed;
    expect(gateway.server.sockets.size).toBe(0);
    expect(db.authSession.findUnique).not.toHaveBeenCalled();
  });

  it('joins only each participant receiving room and leaves idempotently without evicting the other', async () => {
    const student = client({ accessToken: access() });
    const tutor = client({ accessToken: access(TUTOR, Role.TUTOR) });
    await Promise.all([connect(student), connect(tutor)]);
    for (const socket of [student, tutor]) {
      expect(await event(socket, 'conversation_join')).toEqual({
        ok: true,
        conversationId: CONVERSATION,
      });
      expect(await event(socket, 'conversation_join')).toEqual({
        ok: true,
        conversationId: CONVERSATION,
      });
    }
    expect(serverSocket(student).rooms).toEqual(
      new Set([student.id, conversationRecipientRoom(CONVERSATION, STUDENT)]),
    );
    expect(serverSocket(tutor).rooms).toEqual(
      new Set([tutor.id, conversationRecipientRoom(CONVERSATION, TUTOR)]),
    );
    const delivered = once(tutor, 'test_probe');
    const senderEcho = jest.fn();
    student.on('test_probe', senderEcho);
    await gateway.forAuthorizedRecipient(CONVERSATION, TUTOR, (socket) =>
      socket.emit('test_probe', 'synthetic'),
    );
    await expect(delivered).resolves.toEqual(['synthetic']);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await event(student, 'conversation_leave')).toEqual({
        ok: true,
        conversationId: CONVERSATION,
      });
    }
    const dispatch = jest.fn();
    await gateway.forAuthorizedRecipient(CONVERSATION, STUDENT, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(senderEcho).not.toHaveBeenCalled();
    expect(serverSocket(tutor).rooms.has(conversationRecipientRoom(CONVERSATION, TUTOR))).toBe(
      true,
    );
  });

  it.each(['conversation_join', 'conversation_leave'] as const)(
    'rejects a nonparticipant on %s',
    async (name) => {
      const socket = client({ accessToken: access(OTHER) });
      await connect(socket);
      expect(await event(socket, name)).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Conversation access denied' },
      });
      expect(gateway.server.adapter.rooms.has(conversationRecipientRoom(CONVERSATION, OTHER))).toBe(
        false,
      );
    },
  );

  it.each(['conversation_join', 'conversation_leave'] as const)(
    'validates unknown/malformed payloads and missing conversations on %s',
    async (name) => {
      const socket = client({ accessToken: access() });
      await connect(socket);
      for (const payload of [
        null,
        [],
        'room',
        {},
        { conversationId: 'bad' },
        { conversationId: CONVERSATION, userId: TUTOR },
        { conversationId: CONVERSATION, roomName: 'forged' },
      ]) {
        expect(await event(socket, name, payload)).toMatchObject({
          ok: false,
          error: { code: 'VALIDATION_FAILED' },
        });
      }
      expect(db.conversation.findUnique).not.toHaveBeenCalled();
      expect(await event(socket, name, { conversationId: MISSING })).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      expect(serverSocket(socket).rooms.size).toBe(1);
    },
  );

  it.each(['conversation_join', 'conversation_leave', 'dispatch'] as const)(
    'rechecks revocation before %s and clears membership',
    async (name) => {
      const socket = client({ accessToken: access() });
      await connect(socket);
      await event(socket, 'conversation_join');
      const session = sessions.get(`${SESSION}-${STUDENT}`);
      if (!session) throw new Error('Missing fixture');
      session.revokedAt = new Date();
      const disconnected = once(socket, 'disconnect');
      if (name === 'dispatch') {
        const dispatch = jest.fn();
        await gateway.forAuthorizedRecipient(CONVERSATION, STUDENT, dispatch);
        expect(dispatch).not.toHaveBeenCalled();
      } else {
        expect(await event(socket, name)).toMatchObject({
          ok: false,
          error: { code: 'UNAUTHENTICATED' },
        });
      }
      await disconnected;
      expect(
        gateway.server.adapter.rooms.has(conversationRecipientRoom(CONVERSATION, STUDENT)),
      ).toBe(false);
    },
  );

  it('disconnects all tabs for a logged-out session, keeping another session connected', async () => {
    const token = access();
    const first = client({ accessToken: token });
    const second = client({ accessToken: token });
    const other = client({ accessToken: access(TUTOR, Role.TUTOR) });
    await Promise.all([connect(first), connect(second), connect(other)]);
    await Promise.all([event(first, 'conversation_join'), event(second, 'conversation_join')]);
    const disconnected = Promise.all([once(first, 'disconnect'), once(second, 'disconnect')]);
    await authService.logout(
      tokens.signRefreshToken(STUDENT, `${SESSION}-${STUDENT}`, Role.STUDENT),
    );
    await disconnected;
    expect(other.connected).toBe(true);
    expect(gateway.server.adapter.rooms.has(conversationRecipientRoom(CONVERSATION, STUDENT))).toBe(
      false,
    );
  });

  it.each(
    (['conversation_join', 'conversation_leave', 'dispatch'] as const).flatMap((name) =>
      ['consent', 'role', 'account'].map((change) => ({ name, change })),
    ),
  )('rechecks current $change before $name', async ({ name, change }) => {
    const socket = client({ accessToken: access() });
    await connect(socket);
    await event(socket, 'conversation_join');
    const session = sessions.get(`${SESSION}-${STUDENT}`);
    if (!session) {
      throw new Error('Missing fixture');
    }
    if (change === 'consent') {
      session.user.policyVersion = 'outdated';
    } else if (change === 'role') {
      session.user.role = Role.ADMIN;
    } else {
      session.user.accountStatus = AccountStatus.SUSPENDED;
    }
    const disconnected = once(socket, 'disconnect');
    if (name === 'dispatch') {
      const dispatch = jest.fn();
      await gateway.forAuthorizedRecipient(CONVERSATION, STUDENT, dispatch);
      expect(dispatch).not.toHaveBeenCalled();
    } else {
      expect(await event(socket, name)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }
    await disconnected;
    expect(gateway.server.adapter.rooms.has(conversationRecipientRoom(CONVERSATION, STUDENT))).toBe(
      false,
    );
  });

  it('denies a foreign conversation without dropping the socket and blocks a removed participant', async () => {
    const socket = client({ accessToken: access() });
    await connect(socket);
    await event(socket, 'conversation_join');
    for (const name of ['conversation_join', 'conversation_leave'] as const) {
      expect(await event(socket, name, { conversationId: FOREIGN })).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Conversation access denied' },
      });
    }
    expect(socket.connected).toBe(true);
    expect(serverSocket(socket).rooms).toEqual(
      new Set([socket.id, conversationRecipientRoom(CONVERSATION, STUDENT)]),
    );
    const delivered = once(socket, 'test_probe');
    await gateway.forAuthorizedRecipient(CONVERSATION, STUDENT, (server) =>
      server.emit('test_probe', 'synthetic'),
    );
    await expect(delivered).resolves.toEqual(['synthetic']);
    db.conversation.findUnique.mockResolvedValue({ studentUserId: OTHER, tutorUserId: TUTOR });
    const dispatch = jest.fn();
    const disconnected = once(socket, 'disconnect');
    await gateway.forAuthorizedRecipient(CONVERSATION, STUDENT, dispatch);
    await disconnected;
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects a session that expires between connection and room mutation', async () => {
    const socket = client({ accessToken: access() });
    await connect(socket);
    const session = sessions.get(`${SESSION}-${STUDENT}`);
    if (!session) {
      throw new Error('Missing fixture');
    }
    session.expiresAt = new Date(0);
    const disconnected = once(socket, 'disconnect');
    expect(await event(socket, 'conversation_join')).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    await disconnected;
    expect(db.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('closes an oversized transport payload without a room mutation', async () => {
    const socket = client({ accessToken: access() });
    await connect(socket);
    const disconnected = once(socket, 'disconnect');
    socket.emit('conversation_join', { conversationId: CONVERSATION, extra: 'x'.repeat(9_000) });
    await disconnected;
    expect(db.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('does not dispatch after logout during an in-flight membership check', async () => {
    const socket = client({ accessToken: access() });
    await connect(socket);
    await event(socket, 'conversation_join');
    let release: () => void = () => {
      throw new Error('Membership lookup not started');
    };
    let entered = () => {};
    const checking = new Promise<void>((resolve) => {
      entered = resolve;
    });
    db.conversation.findUnique.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ studentUserId: STUDENT, tutorUserId: TUTOR });
          entered();
        }),
    );
    const dispatch = jest.fn();
    const delivery = gateway.forAuthorizedRecipient(CONVERSATION, STUDENT, dispatch);
    await checking;
    const disconnected = once(socket, 'disconnect');
    await authService.logout(
      tokens.signRefreshToken(STUDENT, `${SESSION}-${STUDENT}`, Role.STUDENT),
    );
    release();
    await Promise.all([delivery, disconnected]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('serializes a slow join followed by leave so membership is not restored accidentally', async () => {
    const socket = client({ accessToken: access() });
    await connect(socket);
    let release: () => void = () => {
      throw new Error('Membership lookup not started');
    };
    let entered = () => {};
    const checking = new Promise<void>((resolve) => {
      entered = resolve;
    });
    db.conversation.findUnique.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ studentUserId: STUDENT, tutorUserId: TUTOR });
          entered();
        }),
    );
    const joined = event(socket, 'conversation_join');
    await checking;
    const left = event(socket, 'conversation_leave');
    release();
    await expect(Promise.all([joined, left])).resolves.toEqual([
      { ok: true, conversationId: CONVERSATION },
      { ok: true, conversationId: CONVERSATION },
    ]);
    expect(serverSocket(socket).rooms).toEqual(new Set([socket.id]));
  });

  it('removes receiving rooms for every session after a user-wide reset notification', async () => {
    const first = client({ accessToken: access() });
    const secondSession = activeSession();
    secondSession.id = SESSION;
    sessions.set(SESSION, secondSession);
    const second = client({ accessToken: tokens.signAccessToken(STUDENT, SESSION, Role.STUDENT) });
    const other = client({ accessToken: access(TUTOR, Role.TUTOR) });
    await Promise.all([connect(first), connect(second), connect(other)]);
    await Promise.all([event(first, 'conversation_join'), event(second, 'conversation_join')]);
    const disconnected = Promise.all([once(first, 'disconnect'), once(second, 'disconnect')]);
    for (const session of sessions.values()) {
      if (session.userId === STUDENT) {
        session.revokedAt = new Date();
      }
    }
    revocations.revoke({ userId: STUDENT });
    await disconnected;
    expect(other.connected).toBe(true);
    expect(gateway.server.adapter.rooms.has(conversationRecipientRoom(CONVERSATION, STUDENT))).toBe(
      false,
    );
  });

  it('disconnects at JWT expiry without client activity', async () => {
    access();
    const token = jwt.sign(
      { sub: STUDENT, sid: `${SESSION}-${STUDENT}`, jti: 'short-lived', type: 'access' },
      SECRET,
      {
        issuer: config.issuer,
        audience: config.audience,
        expiresIn: 2,
      },
    );
    const socket = client({ accessToken: token });
    await connect(socket);
    await event(socket, 'conversation_join');
    await once(socket, 'disconnect');
    expect(gateway.server.adapter.rooms.has(conversationRecipientRoom(CONVERSATION, STUDENT))).toBe(
      false,
    );
  });

  it('cleans rooms on disconnect and starts a reconnect with no automatic membership', async () => {
    const socket = client({ accessToken: access() });
    await connect(socket);
    await event(socket, 'conversation_join');
    const closed = once(serverSocket(socket), 'disconnect');
    socket.disconnect();
    await closed;
    expect(gateway.server.adapter.rooms.has(conversationRecipientRoom(CONVERSATION, STUDENT))).toBe(
      false,
    );
    await connect(socket);
    expect(serverSocket(socket).rooms).toEqual(new Set([socket.id]));
  });

  it('bounds concurrent connections, rooms and event rate', async () => {
    const token = access();
    const tabs = Array.from({ length: CHAT_MAX_CONNECTIONS_PER_USER }, () =>
      client({ accessToken: token }),
    );
    await Promise.all(tabs.map(connect));
    const extra = client({ accessToken: token });
    const failed = once(extra, 'connect_error');
    extra.connect();
    const errors: unknown[] = await failed;
    const error = errors[0];
    expect(error).toMatchObject({ data: { code: 'RATE_LIMITED' } });
    const socket = tabs[0];
    if (!socket) throw new Error('Missing client');
    for (let index = 0; index < CHAT_MAX_ROOMS; index++) {
      const conversationId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
      expect(await event(socket, 'conversation_join', { conversationId })).toEqual({
        ok: true,
        conversationId,
      });
    }
    expect(await event(socket, 'conversation_join')).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
    for (let index = CHAT_MAX_ROOMS + 1; index < CHAT_RATE_LIMIT; index++) {
      await event(socket, 'conversation_leave');
    }
    expect(await event(socket, 'conversation_leave')).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    });
  });

  // Every client here shares the loopback peer address, as browsers do behind a proxy.
  it('limits handshakes per verified user rather than per shared peer address', async () => {
    const socket = client({ accessToken: access() });
    for (let attempt = 0; attempt < CHAT_RATE_LIMIT; attempt++) {
      await connect(socket);
      const closed = once(serverSocket(socket), 'disconnect');
      socket.disconnect();
      await closed;
    }
    const failed = once(socket, 'connect_error');
    socket.connect();
    const errors: unknown[] = await failed;
    expect(errors[0]).toMatchObject({ data: { code: 'RATE_LIMITED' } });
    const tutor = client({ accessToken: access(TUTOR, Role.TUTOR) });
    await connect(tutor);
    expect(serverSocket(tutor).rooms).toEqual(new Set([tutor.id]));
  });

  it('does not count unauthenticated handshakes against signed-in users', async () => {
    for (let attempt = 0; attempt <= CHAT_RATE_LIMIT; attempt++) {
      const anonymous = client({ accessToken: 'synthetic-invalid-token' });
      const failed = once(anonymous, 'connect_error');
      anonymous.connect();
      const errors: unknown[] = await failed;
      expect(errors[0]).toMatchObject({ data: { code: 'UNAUTHENTICATED' } });
    }
    const socket = client({ accessToken: access() });
    await connect(socket);
    expect(serverSocket(socket).rooms).toEqual(new Set([socket.id]));
  });

  it('works through the same-origin proxy for polling and WebSocket Upgrade', async () => {
    const web = createServer((_request, response) => response.end('synthetic web'));
    const webUpgrades: string[] = [];
    const webTunnels = new Set<Duplex>();
    web.on('upgrade', (request, socket) => {
      webUpgrades.push(request.url ?? '');
      webTunnels.add(socket);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
      );
      socket.pipe(socket);
    });
    web.listen(0, '127.0.0.1');
    await once(web, 'listening');
    const address = web.address();
    if (!address || typeof address === 'string') throw new Error('Missing web address');
    const child: ChildProcess = spawn(
      process.execPath,
      [path.resolve(process.cwd(), '../../scripts/chat-proxy.mjs')],
      {
        env: {
          ...process.env,
          CHAT_PROXY_PORT: '0',
          API_INTERNAL_URL: url,
          WEB_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    try {
      if (!child.stdout) throw new Error('Missing proxy output');
      const chunks: unknown[] = await once(child.stdout, 'data');
      const chunk = chunks[0];
      const port = Buffer.isBuffer(chunk)
        ? /listening on (\d+)/.exec(chunk.toString())?.[1]
        : undefined;
      if (!port) throw new Error('Proxy did not start');
      const proxyUrl = `http://127.0.0.1:${port}`;
      process.env['WEB_ORIGIN'] = proxyUrl;
      expect(await (await fetch(proxyUrl)).text()).toBe('synthetic web');
      const hmr = httpRequest(`${proxyUrl}/_next/webpack-hmr`, {
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
      });
      hmr.end();
      const upgraded: unknown[] = await Promise.race([
        once(hmr, 'upgrade'),
        once(hmr, 'response').then(() => {
          throw new Error('The proxy answered the hot-reload Upgrade instead of tunneling it');
        }),
      ]);
      const tunnel = upgraded[1];
      if (!(tunnel instanceof Duplex)) throw new Error('Missing web upgrade tunnel');
      tunnel.write('synthetic hmr');
      const echoed: unknown[] = await once(tunnel, 'data');
      expect(String(echoed[0])).toBe('synthetic hmr');
      expect(webUpgrades).toEqual(['/_next/webpack-hmr']);
      tunnel.destroy();
      const token = access();
      const polling = client({ accessToken: token }, proxyUrl, 'polling', proxyUrl);
      const websocket = client({ accessToken: token }, proxyUrl, 'websocket', proxyUrl);
      await Promise.all([connect(polling), connect(websocket)]);
      expect(await event(polling, 'conversation_join')).toEqual({
        ok: true,
        conversationId: CONVERSATION,
      });
      expect(await event(websocket, 'conversation_join')).toEqual({
        ok: true,
        conversationId: CONVERSATION,
      });
      const closed = Promise.all([
        once(serverSocket(polling), 'disconnect'),
        once(serverSocket(websocket), 'disconnect'),
      ]);
      polling.disconnect();
      websocket.disconnect();
      await closed;
    } finally {
      child.kill();
      for (const socket of webTunnels) socket.destroy();
      web.closeAllConnections();
      await new Promise<void>((resolve) => web.close(() => resolve()));
    }
  });
});

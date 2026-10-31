import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeConversationRealtime } from '@/lib/conversation-realtime';

const auth = vi.hoisted(() => ({
  token: 'first-token' as string | null,
  listener: null as ((token: string | null) => void) | null,
  refresh: vi.fn<() => Promise<void>>(),
  io: vi.fn(),
}));

vi.mock('socket.io-client', () => ({ io: auth.io }));
vi.mock('@/lib/api/client', () => ({
  getAccessToken: () => auth.token,
  onAccessTokenChanged: (listener: (token: string | null) => void) => {
    auth.listener = listener;
    return () => {
      auth.listener = null;
    };
  },
  refreshAccessToken: auth.refresh,
}));

const CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Reply = (error: Error | null, reply?: unknown) => void;

class TestSocket {
  connected = false;
  active = true;
  handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  joins: { payload: unknown; ack: Reply }[] = [];
  emit = vi.fn();
  connect = vi.fn(() => this);
  disconnect = vi.fn(() => {
    const connected = this.connected;
    this.connected = false;
    this.active = false;
    if (connected) {
      this.deliver('disconnect', 'io client disconnect');
    }
    return this;
  });
  on(event: string, listener: (...args: unknown[]) => void) {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(listener);
    this.handlers.set(event, handlers);
  }
  off(event: string, listener: (...args: unknown[]) => void) {
    this.handlers.get(event)?.delete(listener);
  }
  timeout() {
    return {
      emit: (_event: string, payload: unknown, ack: Reply) => this.joins.push({ payload, ack }),
    };
  }
  deliver(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((listener) => listener(...args));
  }
  joined() {
    this.connected = true;
    this.active = true;
    this.deliver('connect');
    this.joins.at(-1)?.ack(null, { ok: true, conversationId: CONVERSATION });
  }
}

describe('conversation socket lifecycle', () => {
  let socket: TestSocket;
  let stop: () => void;
  const invalidate = vi.fn();
  const changed = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    auth.token = 'first-token';
    auth.listener = null;
    socket = new TestSocket();
    auth.io.mockReturnValue(socket);
    auth.refresh.mockResolvedValue();
    stop = subscribeConversationRealtime(CONVERSATION, invalidate, changed);
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('authenticates using the current memory token and the same-origin chat contract', () => {
    expect(auth.io).toHaveBeenCalledWith(
      '/chat',
      expect.objectContaining({
        path: '/api/v1/socket.io',
        autoConnect: false,
        forceNew: true,
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
      }),
    );
    const options = auth.io.mock.calls[0]?.[1] as {
      auth: (callback: (payload: unknown) => void) => void;
    };
    const callback = vi.fn();
    auth.token = 'rotated';
    options.auth(callback);
    expect(callback).toHaveBeenCalledWith({ accessToken: 'rotated' });
  });

  it('rejoins after every reconnect and reconciles missed history only after a matching acknowledgement', () => {
    socket.joined();
    expect(socket.joins[0]?.payload).toEqual({ conversationId: CONVERSATION });
    expect(invalidate).toHaveBeenCalledOnce();
    socket.connected = false;
    socket.deliver('disconnect', 'transport close');
    expect(changed).toHaveBeenLastCalledWith('reconnecting');
    socket.joined();
    expect(socket.joins).toHaveLength(2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith('connected');
    expect(socket.handlers.get('message_created')?.size).toBe(1);
  });

  it('uses events only to invalidate this joined conversation, never another room or malformed payloads', () => {
    socket.deliver('message_created', { conversationId: CONVERSATION });
    expect(invalidate).not.toHaveBeenCalled();
    socket.joined();
    invalidate.mockClear();
    for (const event of ['message_created', 'messages_read']) {
      for (const payload of [null, [], CONVERSATION, {}, { conversationId: 'another' }]) {
        socket.deliver(event, payload);
      }
      expect(invalidate).not.toHaveBeenCalled();
      socket.deliver(
        event,
        event === 'message_created'
          ? {
              messageId: '11111111-1111-4111-8111-111111111111',
              conversationId: CONVERSATION.toUpperCase(),
              senderId: '22222222-2222-4222-8222-222222222222',
              text: 'Persisted',
              sentAt: '2026-10-31T03:00:00.000Z',
              readAt: null,
            }
          : {
              conversationId: CONVERSATION.toUpperCase(),
              messageIds: ['11111111-1111-4111-8111-111111111111'],
              readByUserId: '22222222-2222-4222-8222-222222222222',
              readAt: '2026-10-31T04:00:00.000Z',
            },
      );
      expect(invalidate).toHaveBeenCalledOnce();
      invalidate.mockClear();
    }
  });

  it('ignores late join acknowledgements from a disconnected socket', () => {
    socket.connected = true;
    socket.deliver('connect');
    const stale = socket.joins[0];
    socket.connected = false;
    socket.deliver('disconnect', 'transport close');
    socket.connected = true;
    stale?.ack(null, { ok: true, conversationId: CONVERSATION });
    expect(invalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalledWith('connected');
  });
  it('treats malformed acknowledgement errors as unavailable instead of throwing', async () => {
    socket.connected = true;
    socket.deliver('connect');
    expect(() =>
      socket.joins[0]?.ack(null, { ok: false, error: { code: { toString: null } } }),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(4000);
    expect(socket.joins).toHaveLength(2);
    expect(changed).not.toHaveBeenCalledWith('connected');
  });

  it('retries a timed-out room join while REST fallback remains active', async () => {
    socket.connected = true;
    socket.deliver('connect');
    socket.joins[0]?.ack(new Error('timeout'));
    expect(changed).toHaveBeenLastCalledWith('connecting');
    await vi.advanceTimersByTimeAsync(4000);
    expect(socket.joins).toHaveLength(2);
    socket.joins[1]?.ack(null, { ok: true, conversationId: 'wrong-room' });
    expect(changed).not.toHaveBeenCalledWith('connected');
  });

  it.each(['FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED'])(
    'does not retry a rejected %s room',
    async (code) => {
      socket.connected = true;
      socket.deliver('connect');
      socket.joins[0]?.ack(null, { ok: false, error: { code } });
      await vi.advanceTimersByTimeAsync(20000);
      expect(socket.joins).toHaveLength(1);
      expect(socket.disconnect).toHaveBeenCalled();
      expect(auth.refresh).not.toHaveBeenCalled();
    },
  );

  it('refreshes expired handshake auth once and falls back if the refreshed credential is rejected', async () => {
    socket.active = false;
    const error = Object.assign(new Error('expired'), { data: { code: 'UNAUTHENTICATED' } });
    socket.deliver('connect_error', error);
    await vi.waitFor(() => expect(auth.refresh).toHaveBeenCalledOnce());
    socket.deliver('connect_error', error);
    expect(auth.refresh).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenLastCalledWith('authExpired');
  });

  it('recovers server-initiated token expiry and reconnects when REST rotates the token', async () => {
    socket.joined();
    socket.connected = false;
    socket.deliver('disconnect', 'io server disconnect');
    await vi.waitFor(() => expect(auth.refresh).toHaveBeenCalledOnce());
    auth.token = 'new-token';
    auth.listener?.(auth.token);
    expect(socket.connect).toHaveBeenCalled();
    socket.joined();
    expect(changed).toHaveBeenLastCalledWith('connected');
    auth.token = null;
    auth.listener?.(null);
    expect(socket.connected).toBe(false);
    expect(changed).toHaveBeenLastCalledWith('authExpired');
  });

  it('does not reconnect after close while authentication refresh is pending', async () => {
    let resolve = () => {};
    auth.refresh.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    socket.active = false;
    socket.deliver('connect_error', { data: { code: 'UNAUTHENTICATED' } });
    stop();
    const connections = socket.connect.mock.calls.length;
    resolve();
    await vi.advanceTimersByTimeAsync(20000);
    expect(socket.connect).toHaveBeenCalledTimes(connections);
  });

  it('leaves the room and cleans listeners, token subscriptions and retries on close', async () => {
    socket.joined();
    stop();
    invalidate.mockClear();
    socket.deliver('message_created', { conversationId: CONVERSATION });
    await vi.advanceTimersByTimeAsync(20000);
    expect(socket.emit).toHaveBeenCalledWith('conversation_leave', {
      conversationId: CONVERSATION,
    });
    expect([...socket.handlers.values()].every((handlers) => handlers.size === 0)).toBe(true);
    expect(auth.listener).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  });
});

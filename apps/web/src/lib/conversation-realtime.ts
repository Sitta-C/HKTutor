'use client';

import { io } from 'socket.io-client';

import { getAccessToken, onAccessTokenChanged, refreshAccessToken } from '@/lib/api/client';
import { CONVERSATION_POLL_INTERVAL_MS } from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/error';
import { isMessageCreatedEvent, isMessagesReadEvent } from '@/lib/conversation-socket-events';

import type { Socket } from 'socket.io-client';

interface ServerEvents {
  message_created: (payload: unknown) => void;
  messages_read: (payload: unknown) => void;
}

interface ClientEvents {
  conversation_join: (payload: { conversationId: string }, ack: (reply: unknown) => void) => void;
  conversation_leave: (payload: { conversationId: string }) => void;
}

export type ConversationSocketState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'fallback'
  | 'authExpired'
  | 'forbidden'
  | 'missing'
  | 'paused';

function hasConversation(payload: unknown, conversationId: string): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'conversationId' in payload &&
    typeof payload.conversationId === 'string' &&
    payload.conversationId.toLowerCase() === conversationId.toLowerCase()
  );
}

function errorCode(value: unknown): string | null {
  return typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
    ? value.code
    : null;
}

/** Events invalidate REST history; pushed data never replaces the authoritative GET cursor. */
export function subscribeConversationRealtime(
  conversationId: string,
  invalidate: () => void,
  connectionChanged: (state: ConversationSocketState) => void,
): () => void {
  const socket: Socket<ServerEvents, ClientEvents> = io('/chat', {
    path: '/api/v1/socket.io',
    autoConnect: false,
    forceNew: true,
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    timeout: 10_000,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    auth: (callback) => callback({ accessToken: getAccessToken() }),
  });
  let closed = false;
  let joined = false;
  let generation = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let refreshing = false;
  let rejectedToken: string | null = null;
  let hasJoined = false;

  const clearRetry = () => {
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };
  const unavailable = (state: ConversationSocketState = 'fallback') => {
    joined = false;
    generation += 1;
    clearRetry();
    if (!closed) {
      connectionChanged(state);
    }
  };
  const later = (action: () => void) => {
    clearRetry();
    retry = setTimeout(() => {
      retry = null;
      if (!closed && getAccessToken()) {
        action();
      }
    }, CONVERSATION_POLL_INTERVAL_MS);
  };
  const recoverAuthentication = async () => {
    const token = getAccessToken();
    if (closed || refreshing || !token) {
      return;
    }
    socket.disconnect();
    // A rejected refreshed credential must not create an unbounded refresh/reconnect loop.
    if (rejectedToken === token) {
      unavailable('authExpired');
      return;
    }
    refreshing = true;
    rejectedToken = token;
    try {
      await refreshAccessToken();
      if (!closed && getAccessToken()) {
        socket.connect();
      }
    } catch (error) {
      unavailable(error instanceof ApiError && error.status === 401 ? 'authExpired' : 'fallback');
      // REST polling retains its existing refresh/error behavior, including session expiry.
      // A later successful REST refresh notifies the token listener and reconnects the socket.
    } finally {
      refreshing = false;
    }
  };
  const join = () => {
    const attempt = generation;
    socket.timeout(5_000).emit('conversation_join', { conversationId }, (error, reply) => {
      if (closed || !socket.connected || attempt !== generation) {
        return;
      }
      if (
        !error &&
        hasConversation(reply, conversationId) &&
        typeof reply === 'object' &&
        reply !== null &&
        'ok' in reply &&
        reply.ok === true
      ) {
        joined = true;
        hasJoined = true;
        rejectedToken = null;
        connectionChanged('connected');
        invalidate();
        return;
      }
      const code =
        typeof reply === 'object' && reply !== null && 'error' in reply
          ? errorCode(reply.error)
          : null;
      if (code === 'UNAUTHENTICATED') {
        void recoverAuthentication();
      } else if (['FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED'].includes(code ?? '')) {
        socket.disconnect();
        unavailable(code === 'NOT_FOUND' ? 'missing' : 'forbidden');
        invalidate();
      } else {
        later(join);
      }
    });
  };
  const connected = () => {
    unavailable(hasJoined ? 'reconnecting' : 'connecting');
    join();
  };
  const disconnected = (reason: string) => {
    unavailable(reason === 'io client disconnect' ? 'fallback' : 'reconnecting');
    if (reason === 'io server disconnect') {
      void recoverAuthentication();
    }
  };
  const failed = (error: Error & { data?: unknown }) => {
    unavailable();
    const code = errorCode(error.data);
    if (code === 'UNAUTHENTICATED') {
      void recoverAuthentication();
    } else if (code === 'FORBIDDEN') {
      socket.disconnect();
      unavailable('forbidden');
      invalidate();
    } else if (!socket.active) {
      later(() => socket.connect());
    }
  };
  const messageCreated = (payload: unknown) => {
    if (
      !closed &&
      joined &&
      isMessageCreatedEvent(payload) &&
      hasConversation(payload, conversationId)
    ) {
      invalidate();
    }
  };
  const messagesRead = (payload: unknown) => {
    if (
      !closed &&
      joined &&
      isMessagesReadEvent(payload) &&
      hasConversation(payload, conversationId)
    ) {
      invalidate();
    }
  };
  socket.on('connect', connected);
  socket.on('disconnect', disconnected);
  socket.on('connect_error', failed);
  socket.on('message_created', messageCreated);
  socket.on('messages_read', messagesRead);
  const stopWatchingToken = onAccessTokenChanged((token) => {
    unavailable();
    socket.disconnect();
    unavailable(token ? 'connecting' : 'authExpired');
    if (!closed && token) {
      socket.connect();
    }
  });
  if (getAccessToken()) {
    unavailable('connecting');
    socket.connect();
  } else {
    unavailable('authExpired');
  }

  return () => {
    if (closed) {
      return;
    }
    closed = true;
    generation += 1;
    clearRetry();
    stopWatchingToken();
    socket.off('connect', connected);
    socket.off('disconnect', disconnected);
    socket.off('connect_error', failed);
    socket.off('message_created', messageCreated);
    socket.off('messages_read', messagesRead);
    if (joined && socket.connected) {
      socket.emit('conversation_leave', { conversationId });
    }
    socket.disconnect();
  };
}

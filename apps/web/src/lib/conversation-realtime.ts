'use client';

import { io } from 'socket.io-client';

import { getAccessToken, onAccessTokenChanged, refreshAccessToken } from '@/lib/api/client';
import { CONVERSATION_POLL_INTERVAL_MS } from '@/lib/api/conversations';

import type { Socket } from 'socket.io-client';

interface ServerEvents {
  message_created: (payload: unknown) => void;
  messages_read: (payload: unknown) => void;
}

interface ClientEvents {
  conversation_join: (payload: { conversationId: string }, ack: (reply: unknown) => void) => void;
  conversation_leave: (payload: { conversationId: string }) => void;
}

function hasConversation(payload: unknown, conversationId: string): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'conversationId' in payload &&
    typeof payload.conversationId === 'string' &&
    payload.conversationId.toLowerCase() === conversationId.toLowerCase()
  );
}

function errorCode(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'code' in value ? value.code : null;
}

/** Events invalidate REST history; pushed data never replaces the authoritative GET cursor. */
export function subscribeConversationRealtime(
  conversationId: string,
  invalidate: () => void,
  connectionChanged: (joined: boolean) => void,
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

  const clearRetry = () => {
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };
  const unavailable = () => {
    joined = false;
    generation += 1;
    clearRetry();
    if (!closed) {
      connectionChanged(false);
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
      return;
    }
    refreshing = true;
    rejectedToken = token;
    try {
      await refreshAccessToken();
      if (!closed && getAccessToken()) {
        socket.connect();
      }
    } catch {
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
        rejectedToken = null;
        connectionChanged(true);
        invalidate();
        return;
      }
      const code =
        typeof reply === 'object' && reply !== null && 'error' in reply
          ? errorCode(reply.error)
          : null;
      if (code === 'UNAUTHENTICATED') {
        void recoverAuthentication();
      } else if (['FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED'].includes(String(code))) {
        socket.disconnect();
        invalidate();
      } else {
        later(join);
      }
    });
  };
  const connected = () => {
    unavailable();
    join();
  };
  const disconnected = (reason: string) => {
    unavailable();
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
    } else if (!socket.active) {
      later(() => socket.connect());
    }
  };
  const changed = (payload: unknown) => {
    if (!closed && joined && hasConversation(payload, conversationId)) {
      invalidate();
    }
  };
  socket.on('connect', connected);
  socket.on('disconnect', disconnected);
  socket.on('connect_error', failed);
  socket.on('message_created', changed);
  socket.on('messages_read', changed);
  const stopWatchingToken = onAccessTokenChanged((token) => {
    unavailable();
    socket.disconnect();
    if (!closed && token) {
      socket.connect();
    }
  });
  if (getAccessToken()) {
    socket.connect();
  }

  return () => {
    closed = true;
    generation += 1;
    clearRetry();
    stopWatchingToken();
    socket.off('connect', connected);
    socket.off('disconnect', disconnected);
    socket.off('connect_error', failed);
    socket.off('message_created', changed);
    socket.off('messages_read', changed);
    if (joined && socket.connected) {
      socket.emit('conversation_leave', { conversationId });
    }
    socket.disconnect();
  };
}

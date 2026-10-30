import { BadRequestException } from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';

import type { AccessSession } from '@modules/auth/access-session';
import type { MessageResponseDto } from '@modules/conversations/conversations.dto';
import type { Namespace, Socket } from 'socket.io';

export const CHAT_NAMESPACE = '/chat';
export const CHAT_SOCKET_PATH = '/api/v1/socket.io';
export const CHAT_MAX_ROOMS = 10;
export const CHAT_MAX_CONNECTIONS_PER_USER = 5;
export const CHAT_RATE_LIMIT = 30;
export const CHAT_RATE_WINDOW_MS = 10_000;
// Larger reads are split into several messages_read events; REST history reconciles the rest.
export const MESSAGES_READ_MAX_IDS = 100;

export interface ConversationRoomDto {
  conversationId: string;
}

export type ChatErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ChatError {
  code: ChatErrorCode;
  message: string;
}

export type ConversationRoomAck =
  ({ ok: true } & ConversationRoomDto) | { ok: false; error: ChatError };

export interface ChatClientEvents {
  conversation_join: (
    payload: ConversationRoomDto,
    ack: (reply: ConversationRoomAck) => void,
  ) => void;
  conversation_leave: (
    payload: ConversationRoomDto,
    ack: (reply: ConversationRoomAck) => void,
  ) => void;
}

/** S3-T02: exactly the persisted message that POST /conversations/:id/messages returns. */
export type MessageCreatedPayload = MessageResponseDto;

/** S3-T02: only the messages this POST /conversations/:id/read call changed. */
export interface MessagesReadPayload {
  conversationId: string;
  messageIds: string[];
  readByUserId: string;
  readAt: string;
}

// Both events are sent only after a committed REST write, and only to the other participant.
export interface ChatServerEvents {
  message_created: (payload: MessageCreatedPayload) => void;
  messages_read: (payload: MessagesReadPayload) => void;
}
export type ChatSocket = Socket<
  ChatClientEvents,
  ChatServerEvents,
  Record<string, never>,
  { access?: AccessSession }
>;
export type ChatNamespace = Namespace<
  ChatClientEvents,
  ChatServerEvents,
  Record<string, never>,
  { access?: AccessSession }
>;

export function parseConversationRoom(payload: unknown): ConversationRoomDto {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !('conversationId' in payload) ||
    !isUuid(payload.conversationId)
  ) {
    throw new BadRequestException('Invalid conversation payload');
  }
  return { conversationId: payload.conversationId.toLowerCase() };
}

export function conversationRecipientRoom(conversationId: string, userId: string): string {
  return `conversation:${conversationId.toLowerCase()}:user:${userId.toLowerCase()}`;
}

import { ApiError } from '@/lib/api/error';

import type { ConversationMessage, ConversationSummary } from '@/lib/api/types';

export function messageLength(text: string): number {
  return Array.from(text.trim()).length;
}

export function canSendMessage(text: string): boolean {
  const length = messageLength(text);
  return length > 0 && length <= 2000;
}

export function mergeMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
): ConversationMessage[] {
  const messages = new Map(current.map((message) => [message.messageId, message]));
  for (const message of incoming) {
    messages.set(message.messageId, message);
  }
  return [...messages.values()].sort(
    (a, b) => a.sentAt.localeCompare(b.sentAt) || a.messageId.localeCompare(b.messageId),
  );
}

export function mergeConversations(
  current: ConversationSummary[],
  incoming: ConversationSummary[],
): ConversationSummary[] {
  const conversations = new Map(current.map((item) => [item.conversationId, item]));
  for (const item of incoming) {
    conversations.set(item.conversationId, item);
  }
  return [...conversations.values()];
}

export function recordSentMessage(
  current: ConversationSummary[],
  message: ConversationMessage,
): ConversationSummary[] {
  const conversation = current.find((item) => item.conversationId === message.conversationId);
  if (
    !conversation ||
    (conversation.lastMessage && conversation.lastMessage.sentAt > message.sentAt)
  ) {
    return current;
  }
  return [
    { ...conversation, lastMessage: message },
    ...current.filter((item) => item.conversationId !== message.conversationId),
  ];
}

export function conversationErrorKey(
  error: unknown,
): 'expired' | 'forbidden' | 'missing' | 'failed' {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'expired';
    }
    if (error.status === 403) {
      return 'forbidden';
    }
    if (error.status === 404) {
      return 'missing';
    }
  }
  return 'failed';
}

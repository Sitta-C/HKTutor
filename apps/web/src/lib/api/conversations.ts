'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  ConversationListResponse,
  ConversationMessage,
  ConversationMessagesResponse,
  OpenConversationResponse,
} from '@/lib/api/types';

export function getConversations(
  cursor?: string,
  signal: AbortSignal | null = null,
): Promise<ConversationListResponse> {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) {
    query.set('cursor', cursor);
  }
  return authenticatedFetch(`/conversations?${query}`, { signal });
}

export function openTutorConversation(
  tutorId: string,
  signal: AbortSignal | null = null,
): Promise<OpenConversationResponse> {
  return authenticatedFetch('/conversations', {
    method: 'POST',
    body: JSON.stringify({ tutorId }),
    signal,
  });
}

export function getConversationMessages(
  conversationId: string,
  afterMessageId: string | null = null,
  signal: AbortSignal | null = null,
): Promise<ConversationMessagesResponse> {
  const query = new URLSearchParams({ pageSize: '50' });
  if (afterMessageId) {
    query.set('afterMessageId', afterMessageId);
  }
  return authenticatedFetch(
    `/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
    { signal },
  );
}

export function sendConversationMessage(
  conversationId: string,
  text: string,
): Promise<ConversationMessage> {
  return authenticatedFetch(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: text.trim() }),
  });
}

/** The API is forward-only. Follow its cursor to reach the latest message without skipping history. */
export async function loadConversationMessages(
  conversationId: string,
  afterMessageId: string | null,
  signal: AbortSignal,
): Promise<{ items: ConversationMessage[]; cursor: string | null }> {
  let cursor = afterMessageId;
  const items: ConversationMessage[] = [];
  const visited = new Set<string | null>();
  do {
    signal.throwIfAborted();
    if (visited.has(cursor)) {
      throw new Error('Conversation cursor did not advance');
    }
    visited.add(cursor);
    const page = await getConversationMessages(conversationId, cursor, signal);
    items.push(...page.items);
    if (!page.hasMore) {
      return { items, cursor: page.nextAfterMessageId };
    }
    cursor = page.nextAfterMessageId;
  } while (true);
}

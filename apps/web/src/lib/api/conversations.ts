'use client';

import { authenticatedFetch } from '@/lib/api/client';
import { ConversationHistoryLoadError } from '@/lib/api/error';

import type {
  ConversationListResponse,
  ConversationMessage,
  ConversationMessagesResponse,
  OpenConversationResponse,
} from '@/lib/api/types';

export const CONVERSATION_HISTORY_MAX_PAGES = 200;
export const CONVERSATION_HISTORY_TIMEOUT_MS = 60_000;

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

async function readConversationHistory(
  conversationId: string,
  afterMessageId: string | null,
  signal: AbortSignal,
): Promise<{ items: ConversationMessage[]; cursor: string | null }> {
  let cursor = afterMessageId;
  const items: ConversationMessage[] = [];
  const visited = new Set<string | null>([cursor]);
  for (let pageNumber = 0; pageNumber < CONVERSATION_HISTORY_MAX_PAGES; pageNumber += 1) {
    signal.throwIfAborted();
    const page = await getConversationMessages(conversationId, cursor, signal);
    signal.throwIfAborted();
    const next = page.nextAfterMessageId;
    if (
      !Array.isArray(page.items) ||
      typeof page.hasMore !== 'boolean' ||
      (next !== null && typeof next !== 'string') ||
      (page.items.length > 0 && next !== page.items.at(-1)?.messageId)
    ) {
      throw new Error('Invalid conversation history page');
    }
    if (page.hasMore) {
      if (!next || visited.has(next)) {
        throw new Error('Conversation cursor did not advance');
      }
      if (page.items.length === 0) {
        throw new Error('Invalid conversation history page');
      }
      visited.add(next);
    } else if (page.items.length === 0 && next !== null && next !== cursor) {
      throw new Error('Invalid conversation history page');
    }
    items.push(...page.items);
    if (!page.hasMore) {
      return { items, cursor: next ?? cursor };
    }
    cursor = next;
  }
  throw new ConversationHistoryLoadError('limit');
}

/** Reach the end of forward-only history, or fail explicitly without returning partial history. */
export async function loadConversationMessages(
  conversationId: string,
  afterMessageId: string | null,
  signal: AbortSignal,
): Promise<{ items: ConversationMessage[]; cursor: string | null }> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new ConversationHistoryLoadError('timeout')),
    CONVERSATION_HISTORY_TIMEOUT_MS,
  );
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // Also bound awaits inside authentication refresh, which uses a shared request of its own.
    return await Promise.race([
      readConversationHistory(conversationId, afterMessageId, controller.signal),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

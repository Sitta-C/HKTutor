'use client';

import { authenticatedFetch } from '@/lib/api/client';
import { ConversationHistoryLoadError } from '@/lib/api/error';
import { notifyUnreadMessagesChanged } from '@/lib/conversation-events';

import type {
  ConversationListResponse,
  ConversationMessage,
  ConversationMessagesResponse,
  OpenConversationResponse,
  UnreadMessageCountResponse,
} from '@/lib/api/types';

export const CONVERSATION_HISTORY_MAX_PAGES = 200;
export const CONVERSATION_HISTORY_TIMEOUT_MS = 60_000;
export const CONVERSATION_POLL_INTERVAL_MS = 4_000;

export function getUnreadMessageCount(signal: AbortSignal): Promise<UnreadMessageCountResponse> {
  return authenticatedFetch('/conversations/unread-count', { signal, cache: 'no-store' });
}

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
  fromMessageId: string | null = null,
): Promise<ConversationMessagesResponse> {
  const query = new URLSearchParams({ pageSize: '50' });
  if (fromMessageId) {
    query.set('fromMessageId', fromMessageId);
  } else if (afterMessageId) {
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
  fromMessageId: string | null = null,
): Promise<{ items: ConversationMessage[]; cursor: string | null }> {
  let cursor = afterMessageId;
  const items: ConversationMessage[] = [];
  const visited = new Set<string | null>([cursor]);
  for (let pageNumber = 0; pageNumber < CONVERSATION_HISTORY_MAX_PAGES; pageNumber += 1) {
    signal.throwIfAborted();
    const page = await getConversationMessages(
      conversationId,
      cursor,
      signal,
      pageNumber === 0 ? fromMessageId : null,
    );
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
  fromMessageId: string | null = null,
): Promise<{ items: ConversationMessage[]; cursor: string | null }> {
  return withHistoryDeadline(signal, (boundedSignal) =>
    readConversationHistory(conversationId, afterMessageId, boundedSignal, fromMessageId),
  );
}

export interface ConversationHistoryPage {
  items: ConversationMessage[];
  cursor: string | null;
  olderCursor: string | null;
}

/** Fetch one recent/backward page; opening never downloads the entire conversation. */
export function loadOlderConversationMessages(
  conversationId: string,
  beforeMessageId: string | null,
  signal: AbortSignal,
): Promise<ConversationHistoryPage> {
  return withHistoryDeadline(signal, async (boundedSignal) => {
    const query = new URLSearchParams({ pageSize: '20' });
    if (beforeMessageId) {
      query.set('beforeMessageId', beforeMessageId);
    } else {
      query.set('latest', 'true');
    }
    const page = await authenticatedFetch<ConversationMessagesResponse>(
      `/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
      { signal: boundedSignal },
    );
    boundedSignal.throwIfAborted();
    if (
      !Array.isArray(page.items) ||
      typeof page.hasMore !== 'boolean' ||
      page.nextAfterMessageId !== (page.items.at(-1)?.messageId ?? null) ||
      (page.hasMore
        ? !page.nextBeforeMessageId ||
          page.nextBeforeMessageId !== page.items[0]?.messageId ||
          page.nextBeforeMessageId === beforeMessageId
        : page.nextBeforeMessageId !== null)
    ) {
      throw new Error('Invalid backward conversation history page');
    }
    return {
      items: page.items,
      cursor: page.nextAfterMessageId,
      olderCursor: page.nextBeforeMessageId ?? null,
    };
  });
}

export async function markConversationRead(
  conversationId: string,
  upToMessageId: string,
  signal: AbortSignal,
): Promise<{ updatedCount: number; readAt: string | null }> {
  const receipt = await withHistoryDeadline(signal, (boundedSignal) =>
    authenticatedFetch<{ updatedCount: number; readAt: string | null }>(
      `/conversations/${encodeURIComponent(conversationId)}/read`,
      {
        method: 'POST',
        body: JSON.stringify({ upToMessageId }),
        signal: boundedSignal,
      },
    ),
  );
  if (receipt.updatedCount > 0) {
    notifyUnreadMessagesChanged();
  }
  return receipt;
}

async function withHistoryDeadline<T>(
  signal: AbortSignal,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
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
    return await Promise.race([read(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

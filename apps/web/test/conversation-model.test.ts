import { describe, expect, it } from 'vitest';

import { ApiError, ConversationHistoryLoadError } from '@/lib/api/error';
import {
  canSendMessage,
  conversationErrorKey,
  mergeMessages,
  messageLength,
  recordSentMessage,
} from '@/lib/conversation-model';

import type { ConversationMessage, ConversationSummary } from '@/lib/api/types';

const message = (
  messageId: string,
  text: string,
  sentAt = '2026-10-08T10:00:00.000Z',
): ConversationMessage => ({
  messageId,
  text,
  sentAt,
  senderId: 'student',
  conversationId: 'pair',
  readAt: null,
});

describe('conversation boundaries', () => {
  it.each([
    ['timeout', 'historyTimeout'],
    ['limit', 'historyLimit'],
  ] as const)('maps history %s to explicit recovery copy', (reason, key) => {
    expect(conversationErrorKey(new ConversationHistoryLoadError(reason))).toBe(key);
  });
  it('matches trimmed Unicode code-point length, including emoji and newlines', () => {
    expect(messageLength('  สวัสดี\n😀  ')).toBe(8);
    expect(canSendMessage(' \n\t ')).toBe(false);
    expect(canSendMessage('😀'.repeat(2000))).toBe(true);
    expect(canSendMessage('😀'.repeat(2001))).toBe(false);
    expect(canSendMessage('hello\nworld')).toBe(true);
  });

  it('deduplicates a sent response later returned by a refresh and orders concurrent messages', () => {
    const sent = message('c', 'sent');
    const incoming = message('b', 'concurrent');
    expect(mergeMessages([sent], [incoming, { ...sent, readAt: '2026-10-08T11:00:00Z' }])).toEqual([
      incoming,
      { ...sent, readAt: '2026-10-08T11:00:00Z' },
    ]);
    expect(
      mergeMessages([sent], [message('a', 'older', '2026-10-08T09:00:00.000Z')])[0]?.text,
    ).toBe('older');
  });

  it.each([
    [401, 'expired'],
    [403, 'forbidden'],
    [404, 'missing'],
    [500, 'failed'],
  ] as const)('maps %s without showing server details', (status, key) => {
    expect(conversationErrorKey(new ApiError('private database detail', status))).toBe(key);
  });
});

describe('acknowledged sends in the inbox', () => {
  const conversations: ConversationSummary[] = ['first', 'second', 'pair'].map(
    (conversationId) => ({
      conversationId,
      createdAt: '2026-10-08T09:00:00.000Z',
      otherParticipant: { userId: `other-${conversationId}`, displayName: conversationId },
      lastMessage: null,
      unreadCount: 2,
    }),
  );

  it('promotes an older conversation without losing other order, identity or unread metadata', () => {
    const sent = message('sent', 'Ready for the lesson');
    const result = recordSentMessage(conversations, sent);
    expect(result.map((item) => item.conversationId)).toEqual(['pair', 'first', 'second']);
    expect(result[0]).toEqual({ ...conversations[2], lastMessage: sent });
    expect(conversations[2]?.lastMessage).toBeNull();
    expect(recordSentMessage(result, sent)).toEqual(result);
  });

  it('does not replace a newer inbox preview with an older send response', () => {
    const newer = recordSentMessage(
      conversations,
      message('newer', 'Newest', '2026-10-08T12:00:00Z'),
    );
    expect(recordSentMessage(newer, message('older', 'Older'))).toBe(newer);
  });

  it('does not invent a participant for a conversation absent from the inbox', () => {
    expect(
      recordSentMessage(conversations, { ...message('sent', 'Hello'), conversationId: 'missing' }),
    ).toBe(conversations);
  });
});

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/error';
import {
  canSendMessage,
  conversationErrorKey,
  mergeMessages,
  messageLength,
} from '@/lib/conversation-model';

import type { ConversationMessage } from '@/lib/api/types';

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

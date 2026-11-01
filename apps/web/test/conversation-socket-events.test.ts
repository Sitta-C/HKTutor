import { describe, expect, it } from 'vitest';

import { isMessageCreatedEvent, isMessagesReadEvent } from '@/lib/conversation-socket-events';

const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe.each([
  ['message_created', isMessageCreatedEvent],
  ['messages_read', isMessagesReadEvent],
] as const)('%s REST invalidation', (_event, validate) => {
  it('accepts just a conversation ID, regardless of current or future content fields', () => {
    expect(validate({ conversationId })).toBe(true);
    expect(validate({ conversationId: conversationId.toUpperCase() })).toBe(true);
    expect(
      validate({ conversationId, attachments: [], metadata: {}, readAt: 'future-format' }),
    ).toBe(true);
  });

  it.each([
    null,
    [],
    '',
    1,
    {},
    { conversationId: null },
    { conversationId: 1 },
    { conversationId: 'not-a-uuid' },
    { conversationId: ` ${conversationId}` },
  ])('rejects an unusable routing identifier: %j', (payload) => {
    expect(validate(payload)).toBe(false);
  });
});

import { BadRequestException } from '@nestjs/common';

import {
  decodeConversationCursor,
  encodeConversationCursor,
} from '@modules/conversations/conversations.cursor';

const CONVERSATION_ID = '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f';
const ACTIVITY_AT = '2026-09-30T08:05:00.000Z';

const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('conversation list cursor', () => {
  it('decodes the cursor it encodes', () => {
    const cursor = encodeConversationCursor({ activityAt: ACTIVITY_AT, id: CONVERSATION_ID });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeConversationCursor(cursor)).toEqual({
      activityAt: ACTIVITY_AT,
      id: CONVERSATION_ID,
    });
  });

  it.each([
    ['characters outside base64url', 'abc+/='],
    ['a cursor over 512 characters', 'a'.repeat(513)],
    ['text that is not JSON', Buffer.from('not json').toString('base64url')],
    ['a missing id', encodeJson({ activityAt: ACTIVITY_AT })],
    ['an extra key', encodeJson({ activityAt: ACTIVITY_AT, id: CONVERSATION_ID, page: 2 })],
    ['an id that is not a UUID', encodeJson({ activityAt: ACTIVITY_AT, id: 'c-10' })],
    ['a date without a time', encodeJson({ activityAt: '2026-09-30', id: CONVERSATION_ID })],
    ['a value that is not a date', encodeJson({ activityAt: 'yesterday', id: CONVERSATION_ID })],
  ])('rejects %s with 400', (_label, cursor) => {
    expect(() => decodeConversationCursor(cursor)).toThrow(
      new BadRequestException('Invalid conversation list cursor'),
    );
  });
});

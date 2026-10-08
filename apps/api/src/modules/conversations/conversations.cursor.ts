import { BadRequestException } from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';
import { MAX_CONVERSATIONS_CURSOR_LENGTH } from '@modules/conversations/conversations.dto';

/** Where a page of the conversation list ended: the last item's activity time and ID. */
export interface ConversationCursor {
  activityAt: string;
  id: string;
}

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify({ activityAt: cursor.activityAt, id: cursor.id })).toString(
    'base64url',
  );
}

export function decodeConversationCursor(cursor: string): ConversationCursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > MAX_CONVERSATIONS_CURSOR_LENGTH) {
      throw new Error('Invalid cursor');
    }
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !value ||
      typeof value !== 'object' ||
      !('activityAt' in value) ||
      !('id' in value) ||
      Object.keys(value).length !== 2 ||
      typeof value.activityAt !== 'string' ||
      new Date(value.activityAt).toISOString() !== value.activityAt ||
      !isUuid(value.id)
    ) {
      throw new Error('Invalid cursor');
    }
    return { activityAt: value.activityAt, id: value.id };
  } catch {
    throw new BadRequestException('Invalid conversation list cursor');
  }
}

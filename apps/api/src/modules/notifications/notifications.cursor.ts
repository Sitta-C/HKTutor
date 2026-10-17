import { BadRequestException } from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';
import { MAX_NOTIFICATION_CURSOR_LENGTH } from '@modules/notifications/notifications.dto';

interface NotificationCursor {
  createdAt: string;
  id: string;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id })).toString(
    'base64url',
  );
}

export function decodeNotificationCursor(cursor: string): NotificationCursor {
  try {
    if (cursor.length > MAX_NOTIFICATION_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error('Invalid cursor');
    }
    const bytes = Buffer.from(cursor, 'base64url');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      bytes.toString('base64url') !== cursor ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !('createdAt' in value) ||
      !('id' in value) ||
      typeof value.createdAt !== 'string' ||
      // Public API timestamps use four-digit AD years. Date also accepts extreme BC dates
      // outside PostgreSQL's range; reject forged boundaries before they reach persistence.
      !/^(?!0000)\d{4}-\d{2}-\d{2}T/.test(value.createdAt) ||
      new Date(value.createdAt).toISOString() !== value.createdAt ||
      !isUuid(value.id)
    ) {
      throw new Error('Invalid cursor');
    }
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new BadRequestException('Invalid notification list cursor');
  }
}

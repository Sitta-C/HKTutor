import { applyDecorators } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import {
  NotificationReadResponseDto,
  NotificationsReadAllResponseDto,
  NotificationsResponseDto,
} from '@modules/notifications/notifications.dto';

export function NotificationsControllerDoc(): ClassDecorator {
  return applyDecorators(
    ApiTags('notifications'),
    ApiBearerAuth(JWT_BEARER_AUTH),
    ApiUnauthorizedResponse({
      description: '401 UNAUTHENTICATED: missing/invalid token or inactive session',
    }),
  );
}

export function ListNotificationsDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'List the current recipient inbox',
      description:
        'Latest first by createdAt then id. Default limit 20, maximum 50. A 5H reminder (or historical 1H reminder) supersedes 24H reminders for the same recipient and scheduled occurrence; superseded records remain stored but are excluded from items and unreadCount. unreadCount covers the entire visible caller inbox regardless of cursor/filter. GET never marks read. Timestamps are UTC ISO 8601; bookingId supplies booking-link metadata. All authenticated roles access only their own inbox.',
    }),
    ApiOkResponse({ type: NotificationsResponseDto }),
    ApiBadRequestResponse({
      description:
        '400 VALIDATION_FAILED: malformed cursor, invalid limit/unreadOnly, or unknown query fields',
    }),
  );
}

export function MarkNotificationReadDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Mark one own notification read',
      description:
        'No body/query fields. Atomic and idempotent: repeated or concurrent calls preserve the first readAt. Errors use {statusCode,error,message,code,details?}.',
    }),
    ApiOkResponse({ type: NotificationReadResponseDto }),
    ApiBadRequestResponse({
      description:
        '400 INVALID_UUID for invalid notificationId; 400 VALIDATION_FAILED for extra inputs',
    }),
    ApiForbiddenResponse({
      description: '403 FORBIDDEN: the ID belongs to a different recipient; no content is returned',
    }),
    ApiNotFoundResponse({ description: '404 NOT_FOUND: notification does not exist' }),
  );
}

export function MarkAllNotificationsReadDoc(): MethodDecorator {
  return applyDecorators(
    ApiOperation({
      summary: 'Mark all own unread notifications read',
      description:
        'No body/query fields. Only the caller unread inbox rows visible to this statement are updated; superseded 24H reminders, already-read rows and other recipients remain unchanged. Returns updatedCount=0 and readAt=null when nothing changed. Concurrent new events may remain unread.',
    }),
    ApiOkResponse({ type: NotificationsReadAllResponseDto }),
    ApiBadRequestResponse({ description: '400 VALIDATION_FAILED: unexpected body/query fields' }),
  );
}

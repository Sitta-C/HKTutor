import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
} from '@modules/notifications/notifications.cursor';
import { DEFAULT_NOTIFICATIONS_LIMIT } from '@modules/notifications/notifications.dto';

import type {
  GetNotificationsQueryDto,
  NotificationReadResponseDto,
  NotificationsReadAllResponseDto,
  NotificationsResponseDto,
} from '@modules/notifications/notifications.dto';

const INBOX_SELECT = {
  bookingId: true,
  createdAt: true,
  eventType: true,
  id: true,
  readAt: true,
  title: true,
} satisfies Prisma.NotificationSelect;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: GetNotificationsQueryDto): Promise<NotificationsResponseDto> {
    const cursor = query.cursor === undefined ? undefined : decodeNotificationCursor(query.cursor);
    const limit = query.limit ?? DEFAULT_NOTIFICATIONS_LIMIT;
    // One snapshot keeps the page and inbox-wide unread count consistent during concurrent reads.
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.notification.findMany({
          where: {
            userId,
            ...(query.unreadOnly ? { readAt: null } : {}),
            ...(cursor === undefined
              ? {}
              : {
                  OR: [
                    { createdAt: { lt: new Date(cursor.createdAt) } },
                    { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                  ],
                }),
          },
          select: INBOX_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        });
        const unreadCount = await tx.notification.count({ where: { userId, readAt: null } });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          items: page.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            readAt: row.readAt?.toISOString() ?? null,
          })),
          nextCursor:
            rows.length > limit && last
              ? encodeNotificationCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
              : null,
          unreadCount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationReadResponseDto> {
    // A single row-locked statement preserves the first receipt even when callers race.
    // Use the database clock and clamp to createdAt to satisfy Notification_read_time_check.
    const [row] = await this.prisma.$queryRaw<{ id: string; readAt: Date }[]>(Prisma.sql`
      UPDATE "Notification"
      SET "readAt" = COALESCE("readAt", GREATEST(statement_timestamp(), "createdAt"))
      WHERE "id" = ${notificationId}::uuid AND "userId" = ${userId}::uuid
      RETURNING "id", "readAt"
    `);
    if (row) {
      return { id: row.id, readAt: row.readAt.toISOString() };
    }
    // The contract distinguishes a missing ID from another recipient's ID. Only check existence;
    // no foreign notification content or recipient identity is loaded or returned.
    const exists = await this.prisma.notification.count({ where: { id: notificationId } });
    if (exists) {
      throw new ForbiddenException('Only the recipient can mark this notification read');
    }
    throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string): Promise<NotificationsReadAllResponseDto> {
    const [row] = await this.prisma.$queryRaw<
      { updatedCount: number; readAt: Date | null }[]
    >(Prisma.sql`
      WITH updated AS (
        UPDATE "Notification"
        SET "readAt" = GREATEST(statement_timestamp(), "createdAt")
        WHERE "userId" = ${userId}::uuid AND "readAt" IS NULL
        RETURNING "readAt"
      )
      SELECT count(*)::int AS "updatedCount", max("readAt") AS "readAt" FROM updated
    `);
    return { updatedCount: row?.updatedCount ?? 0, readAt: row?.readAt?.toISOString() ?? null };
  }
}

import { Prisma } from '@generated/prisma/client';

/** Query alias n is the candidate notification; event keys identify one scheduled occurrence. */
export function visibleNotificationPredicate(userId: string): Prisma.Sql {
  return Prisma.sql`
    n."userId" = ${userId}::uuid
    AND NOT (
      n."eventType" IN ('CLASS_REMINDER_24H', 'PAYMENT_REMINDER_24H')
      AND n."eventKey" LIKE 'reminder:%'
      AND EXISTS (
        SELECT 1 FROM "Notification" AS urgent
        WHERE urgent."userId" = n."userId"
          AND urgent."bookingId" = n."bookingId"
          AND urgent."eventType" IN ('CLASS_REMINDER_1H', 'PAYMENT_REMINDER_1H')
          AND urgent."eventKey" IN (
            regexp_replace(n."eventKey", ':24H:(CLASS|PAYMENT)$', '') || ':1H:CLASS',
            regexp_replace(n."eventKey", ':24H:(CLASS|PAYMENT)$', '') || ':1H:PAYMENT'
          )
      )
    )
  `;
}

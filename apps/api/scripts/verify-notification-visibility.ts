import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { config as loadEnvironment } from 'dotenv';
import { Pool } from 'pg';

import { normalizeDatabaseUrlForPg } from '@config/database-url';
import { Prisma } from '@generated/prisma/client';
import { visibleNotificationPredicate } from '@modules/notifications/notification-visibility';
import { reminderEventKey } from '@modules/notifications/reminder-policy';

import type { ReminderBand, ReminderKind } from '@modules/notifications/reminder-policy';

const userId = randomUUID();
const bookingId = randomUUID();
const slotId = randomUUID();
const startAtUtc = new Date('2099-01-01T12:00:00.000Z');
let checkpoint = 'configuration/connection';

function reminder(
  id: string,
  band: ReminderBand,
  changes: {
    userId?: string;
    bookingId?: string;
    slotId?: string;
    startAtUtc?: Date;
    kind?: ReminderKind;
    readAt?: string;
  } = {},
) {
  const kind = changes.kind ?? 'PAYMENT';
  const occurrence = {
    id: changes.bookingId ?? bookingId,
    slotId: changes.slotId ?? slotId,
    startAtUtc: changes.startAtUtc ?? startAtUtc,
  };
  return {
    id,
    userId: changes.userId ?? userId,
    bookingId: occurrence.id,
    eventType: `${kind}_REMINDER_${band}`,
    eventKey: reminderEventKey(occurrence, band, kind),
    readAt: changes.readAt ?? null,
  };
}

/** Exercises the real key builder and SQL together; CTE fixtures never touch persisted rows. */
async function verify(): Promise<void> {
  loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });
  loadEnvironment({ quiet: true });
  const databaseUrl = process.env['DATABASE_URL'];
  assert.ok(databaseUrl, 'DATABASE_URL is required for the read-only visibility check');
  const pool = new Pool({
    connectionString: normalizeDatabaseUrlForPg(databaseUrl),
    connectionTimeoutMillis: 10_000,
    max: 1,
  });
  const old = reminder('old', '24H');
  const urgent = reminder('urgent', '1H');
  const qr = {
    ...old,
    id: 'qr',
    eventType: 'PAYMENT_QR_READY',
    eventKey: `PAYMENT_QR_READY:${randomUUID()}`,
  };
  const cases = [
    { name: '24H alone', rows: [old], expected: ['old'] },
    {
      name: 'historical 5H still supersedes',
      rows: [
        old,
        {
          ...urgent,
          eventType: 'PAYMENT_REMINDER_5H',
          eventKey: urgent.eventKey.replace(':1H:', ':5H:'),
        },
      ],
      expected: ['urgent'],
    },
    { name: '1H alone', rows: [urgent], expected: ['urgent'] },
    { name: '1H supersedes 24H', rows: [old, urgent], expected: ['urgent'] },
    {
      name: 'read 1H still supersedes',
      rows: [old, { ...urgent, readAt: startAtUtc.toISOString() }],
      expected: ['urgent'],
    },
    {
      name: 'original read 24H stays suppressed',
      rows: [{ ...old, readAt: startAtUtc.toISOString() }, urgent],
      expected: ['urgent'],
    },
    {
      name: 'other recipients',
      rows: [old, reminder('peer', '1H', { userId: randomUUID() })],
      expected: ['old'],
    },
    {
      name: 'other bookings',
      rows: [old, reminder('peer', '1H', { bookingId: randomUUID() })],
      expected: ['old', 'peer'],
    },
    {
      name: 'rescheduled slot',
      rows: [old, reminder('peer', '1H', { slotId: randomUUID() })],
      expected: ['old', 'peer'],
    },
    {
      name: 'rescheduled start',
      rows: [old, reminder('peer', '1H', { startAtUtc: new Date('2099-01-02T12:00:00Z') })],
      expected: ['old', 'peer'],
    },
    {
      name: 'same UTC instant',
      rows: [old, reminder('peer', '1H', { startAtUtc: new Date('2099-01-01T19:00:00+07:00') })],
      expected: ['peer'],
    },
    {
      name: 'unpaid to paid',
      rows: [old, reminder('peer', '1H', { kind: 'CLASS' })],
      expected: ['peer'],
    },
    {
      name: 'class urgency',
      rows: [reminder('old', '24H', { kind: 'CLASS' }), reminder('peer', '1H', { kind: 'CLASS' })],
      expected: ['peer'],
    },
    { name: 'QR independence', rows: [old, urgent, qr], expected: ['qr', 'urgent'] },
    {
      name: 'legacy keys',
      rows: [{ ...old, eventKey: 'legacy' }, urgent],
      expected: ['old', 'urgent'],
    },
  ];
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      for (const test of cases) {
        checkpoint = test.name;
        const fixture = Prisma.sql`WITH "Notification" AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(test.rows)}::jsonb) AS fixture(
            "id" text, "userId" uuid, "bookingId" uuid, "eventType" text,
            "eventKey" text, "readAt" timestamptz
          )
        )`;
        const query = Prisma.sql`${fixture}
          SELECT n."id", n."readAt" FROM "Notification" AS n
          WHERE ${visibleNotificationPredicate(userId)} ORDER BY n."id"`;
        const result = await client.query<{ id: string; readAt: Date | null }>(
          query.text,
          query.values,
        );
        assert.deepEqual(
          result.rows.map(({ id }) => id),
          test.expected,
          test.name,
        );
        const countQuery = Prisma.sql`${fixture}
          SELECT COUNT(*)::int AS count FROM "Notification" AS n
          WHERE ${visibleNotificationPredicate(userId)} AND n."readAt" IS NULL`;
        const count = await client.query<{ count: number }>(countQuery.text, countQuery.values);
        assert.equal(
          count.rows[0]?.count,
          result.rows.filter(({ readAt }) => readAt === null).length,
          test.name,
        );
        process.stdout.write(`PASS read-only reminder key/visibility: ${test.name}\n`);
      }
      process.stdout.write(
        `Passed ${cases.length} PostgreSQL visibility cases; no persisted rows changed.\n`,
      );
    } finally {
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

void verify().catch(() => {
  // Connection errors may embed database credentials; do not print their raw messages.
  process.stderr.write(`Read-only notification visibility verification failed at ${checkpoint}.\n`);
  process.exitCode = 1;
});

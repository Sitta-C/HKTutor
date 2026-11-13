import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression, ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';

import {
  AccountStatus,
  BookingStatus,
  PaymentStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { NotificationEventsService } from '@modules/notifications/notification-events.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { REMINDER_JOB_NAME, ReminderJobService } from '@modules/notifications/reminder-job.service';

import type { ReminderRunResult } from '@modules/notifications/reminder-job.service';
import type { ReminderBand, ReminderKind } from '@modules/notifications/reminder-policy';
import type { TestingModule } from '@nestjs/testing';
import type { PoolClient } from 'pg';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Every scenario owns its own day, three days apart, so no 24-hour scan sees another scenario.
const BASE_MS = Date.UTC(2099, 0, 1);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function scenarioDay(index: number): number {
  return BASE_MS + index * 3 * DAY_MS;
}

function outcome(
  scanned: number,
  created: number,
  duplicates: number,
  failed = 0,
): ReminderRunResult {
  return { scanned, created, duplicates, failed };
}

export function disposableReminderDatabaseUrl(env: NodeJS.ProcessEnv): string {
  assert.equal(
    env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable opt-in required',
  );
  const value = env['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required; this runner never loads .env');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[_-].*[_-]test$/);
  assert.equal(url.search, '', 'URL options are not accepted');
  assert.equal(url.hash, '', 'URL fragments are not accepted');
  return value;
}

interface Fixture {
  id: string;
  slotId: string;
  startAtUtc: Date;
  tutorId: string;
}

async function verify(): Promise<void> {
  const databaseUrl = disposableReminderDatabaseUrl(process.env);
  assert.notEqual(process.env['NODE_ENV'], 'test', 'Run outside Jest so the cron is enabled');
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  // A second client stands in for a second API process running the same job.
  const otherPrisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const studentId = randomUUID();
  const tutorIds = [randomUUID(), randomUUID(), randomUUID()] as const;
  const [tutorId] = tutorIds;
  const users = [studentId, ...tutorIds];
  const subjectId = randomUUID();
  const gradeId = randomUUID();
  const listingIds = new Map<string, string>(tutorIds.map((id) => [id, randomUUID()]));
  const listingOf = (owner: string): string => {
    const id = listingIds.get(owner);
    assert.ok(id, 'Every tutor fixture has a listing');
    return id;
  };
  const failingFunction = `reminder_probe_${randomUUID().replaceAll('-', '')}`;
  const modules: TestingModule[] = [];
  const evidence: string[] = [];
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [real services + PostgreSQL] ${label}\n`);
  };

  async function dropFailureProbe(): Promise<void> {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${failingFunction}" ON "Notification"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${failingFunction}"()`);
  }

  try {
    await prisma.$connect();
    await otherPrisma.$connect();
    const target = await prisma.$queryRaw<{ database: string; schema: string }[]>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)), schema: 'public' },
    ]);
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    assert.equal(
      applied.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
    );
    const finished = new Set(
      applied
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    );
    assert.deepEqual(
      committed.filter((name) => !finished.has(name)),
      [],
      'Apply all migrations first',
    );
    assert.equal(await prisma.booking.count(), 0, 'Use an empty disposable database');

    async function jobFor(client: PrismaService, schedule = false): Promise<TestingModule> {
      const moduleRef = await Test.createTestingModule({
        imports: schedule ? [ScheduleModule.forRoot()] : [],
        providers: [
          ReminderJobService,
          NotificationEventsService,
          { provide: PrismaService, useValue: client },
        ],
      }).compile();
      modules.push(moduleRef);
      return moduleRef;
    }
    const job = (await jobFor(prisma)).get(ReminderJobService);
    const otherJob = (await jobFor(otherPrisma)).get(ReminderJobService);

    await prisma.user.createMany({
      data: [
        { id: studentId, email: `${studentId}@reminder-job.invalid`, role: Role.STUDENT },
        ...tutorIds.map((id) => ({
          id,
          email: `${id}@reminder-job.invalid`,
          role: Role.TUTOR,
        })),
      ].map((user) => ({
        ...user,
        emailVerifiedAt: new Date(),
        consentAcceptedAt: new Date(),
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      })),
    });
    await prisma.tutorProfile.createMany({
      data: tutorIds.map((userId) => ({
        userId,
        displayName: 'Synthetic tutor',
        bio: 'Reminder job test fixture',
        experienceYears: 0,
        verificationStatus: TutorVerificationStatus.VERIFIED,
      })),
    });
    await prisma.subject.create({ data: { id: subjectId, code: subjectId, name: subjectId } });
    await prisma.gradeLevel.create({
      data: { id: gradeId, code: gradeId, name: gradeId, sortOrder: 1 },
    });
    await prisma.teachingListing.createMany({
      data: tutorIds.map((id) => ({
        id: listingOf(id),
        tutorProfileId: id,
        subjectId,
        gradeLevelId: gradeId,
        pricePerHour: '450.00',
        description: 'Synthetic reminder job verification course',
        publicationStatus: 'PUBLISHED' as const,
        publishedAt: new Date(),
      })),
    });

    async function slot(startMs: number, owner: string = tutorId): Promise<string> {
      const row = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: owner,
          startAtUtc: new Date(startMs),
          endAtUtc: new Date(startMs + HOUR_MS),
        },
      });
      return row.id;
    }
    async function booking(
      startMs: number,
      status: BookingStatus = BookingStatus.CONFIRMED,
      paid = false,
    ): Promise<Fixture> {
      const row = await prisma.booking.create({
        data: {
          studentUserId: studentId,
          tutorProfileId: tutorId,
          listingId: listingOf(tutorId),
          slotId: await slot(startMs),
          status,
          subtotalAmount: '450.00',
          netAmount: '450.00',
          ...(paid
            ? {
                paymentStatus: PaymentStatus.PAID,
                paidAt: new Date(),
                mockReference: `mock-${randomUUID()}`,
              }
            : {}),
          ...(status === BookingStatus.CANCELED
            ? {
                canceledById: studentId,
                cancellationReason: 'Synthetic cancellation',
                canceledAt: new Date(),
              }
            : {}),
        },
        include: { slot: true },
      });
      return { id: row.id, slotId: row.slotId, startAtUtc: row.slot.startAtUtc, tutorId };
    }
    async function stored(item: Pick<Fixture, 'id'>): Promise<string[]> {
      const rows = await prisma.notification.findMany({
        where: { bookingId: item.id },
        select: { userId: true, eventKey: true, eventType: true },
      });
      for (const row of rows) {
        const parts = row.eventKey.split(':');
        assert.equal(row.eventType, `${parts.at(-1)}_REMINDER_${parts.at(-2)}`);
      }
      return rows.map(({ userId, eventKey }) => `${userId} ${eventKey}`).sort();
    }
    function planned(
      item: Fixture,
      band: ReminderBand,
      recipients: { student?: boolean; tutor?: boolean; payment?: boolean } = {},
    ): string[] {
      const { payment = true, student = !payment, tutor = !payment } = recipients;
      // Independent oracle: do not let the production key builder hide a regression in itself.
      const key = (kind: ReminderKind): string =>
        `reminder:${item.id}:${item.slotId}:${item.startAtUtc.toISOString()}:${band}:${kind}`;
      return [
        ...(student ? [`${studentId} ${key('CLASS')}`] : []),
        ...(tutor ? [`${item.tutorId} ${key('CLASS')}`] : []),
        ...(payment ? [`${studentId} ${key('PAYMENT')}`] : []),
      ].sort();
    }
    const run = (worker: ReminderJobService, nowMs: number): Promise<ReminderRunResult> =>
      worker.runOnce(new Date(nowMs));

    const bangkok = (date: Date): string =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Bangkok',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(date) + `.${String(date.getUTCMilliseconds()).padStart(3, '0')}`;

    async function assertRows(
      label: string,
      item: Fixture,
      nowMs: number,
      expected: string[],
    ): Promise<void> {
      assert.deepEqual(await stored(item), expected, label);
      const pairs = expected.map((pair) => {
        const [recipient, eventKey] = pair.split(' ');
        const parts = eventKey?.split(':');
        const suffix = `${recipient === studentId ? 'S' : 'T'}:${parts?.at(-2)}:${parts?.at(-1)}`;
        return parts?.[2] === item.slotId ? suffix : `${suffix} (key ${eventKey})`;
      });
      evidence.push(
        `| ${label} | ${item.id} | ${item.slotId} | ${new Date(nowMs).toISOString()} / ${bangkok(new Date(nowMs))} | ` +
          `${item.startAtUtc.toISOString()} / ${bangkok(item.startAtUtc)} | ${pairs.join(', ') || 'none'} | ${expected.length}; exact DB pairs + event types matched |`,
      );
    }

    // Hold a real row lock until every worker is observed waiting for it in PostgreSQL, then
    // commit the competing change. There is no sleep-based assumption that work overlaps.
    async function whileBookingLocked(
      bookingId: string,
      change: (client: PoolClient) => Promise<unknown>,
      workers: (() => Promise<ReminderRunResult>)[],
    ): Promise<ReminderRunResult[]> {
      const blocker = await control.connect();
      let jobs: Promise<ReminderRunResult>[] = [];
      let holdingLock = false;
      try {
        await blocker.query('BEGIN');
        holdingLock = true;
        await blocker.query('SELECT "id" FROM "Booking" WHERE "id" = $1 FOR UPDATE', [bookingId]);
        await change(blocker);
        jobs = workers.map((worker) => worker());
        void Promise.allSettled(jobs);
        const deadline = Date.now() + 5000;
        for (;;) {
          const waiting = await control.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'
               AND query LIKE $1`,
            ['%FROM "Booking"%FOR UPDATE%'],
          );
          if ((waiting.rows[0]?.count ?? 0) >= jobs.length) {
            break;
          }
          assert.ok(Date.now() < deadline, 'Every worker must wait for the booking row lock');
          // Query observed lock state again; elapsed time never decides when to commit.
        }
        await blocker.query('COMMIT');
        holdingLock = false;
        return await Promise.all(jobs);
      } finally {
        if (holdingLock) {
          await blocker.query('ROLLBACK');
        }
        await Promise.allSettled(jobs);
        blocker.release();
      }
    }

    // 1. The cron is registered and running outside Jest, once a minute on UTC.
    const scheduled = await jobFor(prisma, true);
    const app = scheduled.createNestApplication({ logger: false });
    await app.init();
    const cron = app.get(SchedulerRegistry).getCronJob(REMINDER_JOB_NAME);
    assert.equal(cron.cronTime.source, CronExpression.EVERY_MINUTE);
    assert.equal(cron.cronTime.timeZone, 'UTC');
    assert.equal(cron.isActive, true);
    const next = cron.nextDate().toUTC();
    assert.equal(next.second, 0);
    assert.ok(next.toMillis() - Date.now() <= MINUTE_MS);
    await app.close();
    assert.equal(cron.isActive, false);
    pass('the job registers and starts outside Jest: every minute, UTC, stopped on shutdown');

    // 2. Band boundaries at exactly and 1 ms either side of 24h, 1h and the start instant.
    const boundary = await booking(scenarioDay(1) + 12 * HOUR_MS);
    const start = boundary.startAtUtc.getTime();
    assert.deepEqual(await run(job, start - DAY_MS - 1), outcome(0, 0, 0));
    assert.deepEqual(await stored(boundary), []);
    assert.deepEqual(await run(job, start - DAY_MS), outcome(1, 1, 0));
    assert.deepEqual(await stored(boundary), planned(boundary, '24H'));
    assert.deepEqual(await run(job, start - DAY_MS + 1), outcome(1, 0, 1));
    assert.deepEqual(await run(job, start - HOUR_MS - 1), outcome(1, 0, 1));
    assert.deepEqual(await run(job, start - HOUR_MS), outcome(1, 1, 0));
    assert.deepEqual(await run(job, start - HOUR_MS + 1), outcome(1, 0, 1));
    const bothBands = [...planned(boundary, '24H'), ...planned(boundary, '1H')].sort();
    assert.deepEqual(await stored(boundary), bothBands);
    assert.deepEqual(await run(job, start - 1), outcome(1, 0, 1));
    assert.deepEqual(await run(job, start), outcome(0, 0, 0));
    assert.deepEqual(await run(job, start + 1), outcome(0, 0, 0));
    assert.deepEqual(await stored(boundary), bothBands);
    const sample = await prisma.notification.findFirstOrThrow({
      where: { bookingId: boundary.id, eventType: 'PAYMENT_REMINDER_1H' },
    });
    assert.equal(sample.userId, studentId);
    assert.equal(sample.readAt, null);
    assert.equal(sample.title, 'Payment due for your class');
    assert.equal(sample.body, 'Your lesson starts within 1 hour and is still unpaid.');
    pass('24h, 1h and start boundaries ±1 ms pick the right band; the start instant is excluded');

    // 3. Only CONFIRMED bookings are reminded, and only an unpaid student gets a payment reminder.
    const statusDay = scenarioDay(2);
    const others: Fixture[] = [];
    for (const [index, status] of [
      BookingStatus.PENDING,
      BookingStatus.COMPLETED,
      BookingStatus.CANCELED,
      BookingStatus.EXPIRED,
    ].entries()) {
      others.push(await booking(statusDay + (index + 1) * 2 * HOUR_MS, status));
    }
    const unpaid = await booking(statusDay + 12 * HOUR_MS);
    const paid = await booking(statusDay + 14 * HOUR_MS, BookingStatus.CONFIRMED, true);
    assert.deepEqual(await run(job, statusDay), outcome(2, 3, 0));
    assert.deepEqual(await stored(unpaid), planned(unpaid, '24H'));
    assert.deepEqual(await stored(paid), planned(paid, '24H', { payment: false }));
    for (const item of others) {
      assert.deepEqual(await stored(item), []);
    }
    pass(
      'PENDING/COMPLETED/CANCELED/EXPIRED get nothing; only paid bookings send class reminders to both participants',
    );

    // 4. Suspended or deleted recipients are skipped; the other participant is still reminded.
    const suspendedDay = scenarioDay(3);
    const forSuspended = await booking(suspendedDay + 12 * HOUR_MS);
    await prisma.user.update({
      where: { id: studentId },
      data: { accountStatus: AccountStatus.SUSPENDED },
    });
    assert.deepEqual(await run(job, suspendedDay), outcome(1, 0, 0));
    assert.deepEqual(await stored(forSuspended), []);
    await prisma.user.update({
      where: { id: studentId },
      data: { accountStatus: AccountStatus.ACTIVE },
    });
    const deletedDay = scenarioDay(4);
    const forDeleted = await booking(deletedDay + 12 * HOUR_MS);
    await prisma.user.update({
      where: { id: tutorId },
      data: { accountStatus: AccountStatus.DELETED, deletedAt: new Date() },
    });
    assert.deepEqual(await run(job, deletedDay), outcome(1, 1, 0));
    assert.deepEqual(await stored(forDeleted), planned(forDeleted, '24H', { tutor: false }));
    await prisma.user.update({
      where: { id: tutorId },
      data: { accountStatus: AccountStatus.ACTIVE, deletedAt: null },
    });
    pass(
      'a suspended student or deleted tutor is skipped without sending unpaid tutor class reminders',
    );

    // 5. A late first run sends one catch-up band, then repeats are no-ops that take no lock.
    const late = await booking(scenarioDay(5) + 12 * HOUR_MS);
    const lateNow = late.startAtUtc.getTime() - 30 * MINUTE_MS;
    assert.deepEqual(await run(job, lateNow), outcome(1, 1, 0));
    assert.deepEqual(await stored(late), planned(late, '1H'));
    const before = await prisma.notification.findMany({
      where: { bookingId: late.id },
      orderBy: { id: 'asc' },
    });
    const blocker = await control.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT "id" FROM "Booking" WHERE "id" = $1 FOR UPDATE', [late.id]);
      // The interactive transaction timeout bounds a broken implementation; no clock is advanced.
      const repeat = await run(job, lateNow);
      assert.deepEqual(repeat, outcome(1, 0, 1), 'A fully stored booking must not be locked');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    assert.deepEqual(await run(job, lateNow + MINUTE_MS), outcome(1, 0, 1));
    assert.deepEqual(
      await prisma.notification.findMany({ where: { bookingId: late.id }, orderBy: { id: 'asc' } }),
      before,
    );
    pass('a late first run sends only 1H; repeated runs keep the original rows and skip the lock');

    // 6. Two job processes racing on one booking store each reminder exactly once.
    const racedDay = scenarioDay(6);
    const raced = await booking(racedDay + 12 * HOUR_MS);
    const results = await whileBookingLocked(raced.id, () => Promise.resolve(), [
      () => run(job, racedDay),
      () => run(otherJob, racedDay),
    ]);
    assert.deepEqual(
      results.reduce(
        (sum, result) =>
          outcome(
            sum.scanned + result.scanned,
            sum.created + result.created,
            sum.duplicates + result.duplicates,
            sum.failed + result.failed,
          ),
        outcome(0, 0, 0),
      ),
      outcome(2, 1, 1),
    );
    await assertRows('two workers', raced, racedDay, planned(raced, '24H'));
    pass('two processes waiting on the same booking lock create each reminder once, no failures');

    // 7. A payment committed while the job waits for the lock removes the payment reminder.
    const paymentDay = scenarioDay(7);
    const paying = await booking(paymentDay + 12 * HOUR_MS);
    const [afterPayment] = await whileBookingLocked(
      paying.id,
      (client) =>
        client.query(
          `UPDATE "Booking" SET "paymentStatus" = 'paid', "paidAt" = now(), "mockReference" = $2
           WHERE "id" = $1`,
          [paying.id, `mock-${randomUUID()}`],
        ),
      [() => run(job, paymentDay)],
    );
    assert.deepEqual(afterPayment, outcome(1, 2, 0));
    await assertRows(
      'payment commits after scan',
      paying,
      paymentDay,
      planned(paying, '24H', { payment: false }),
    );
    pass('payment committed under the booking lock: class reminders only, no payment reminder');

    // 8. A cancellation committed while the job waits for the lock writes nothing.
    const cancelDay = scenarioDay(8);
    const canceling = await booking(cancelDay + 12 * HOUR_MS);
    const [afterCancel] = await whileBookingLocked(
      canceling.id,
      (client) =>
        client.query(
          `UPDATE "Booking" SET "status" = 'canceled', "canceledById" = $2,
             "cancellationReason" = 'Synthetic cancellation', "canceledAt" = now()
           WHERE "id" = $1`,
          [canceling.id, studentId],
        ),
      [() => run(job, cancelDay)],
    );
    assert.deepEqual(afterCancel, outcome(1, 0, 0));
    await assertRows('cancel commits after scan', canceling, cancelDay, []);
    pass('cancellation committed under the booking lock leaves no reminder behind');

    // 9. A reschedule committed while the job waits re-keys reminders to the new slot and band.
    const rescheduleDay = scenarioDay(9);
    const moving = await booking(rescheduleDay + 20 * HOUR_MS);
    const newStart = rescheduleDay + 30 * MINUTE_MS;
    const newSlotId = await slot(newStart);
    const [afterReschedule] = await whileBookingLocked(
      moving.id,
      (client) =>
        client.query('UPDATE "Booking" SET "slotId" = $2 WHERE "id" = $1', [moving.id, newSlotId]),
      [() => run(job, rescheduleDay)],
    );
    assert.deepEqual(afterReschedule, outcome(1, 1, 0));
    const moved = { ...moving, slotId: newSlotId, startAtUtc: new Date(newStart) };
    await assertRows('reschedule commits after scan', moved, rescheduleDay, planned(moved, '1H'));
    pass('reschedule committed under the booking lock: reminders use the new slot, not the old');

    // S3-T08: a previously notified occurrence can move to a fresh slot in the same band.
    const nextStart = rescheduleDay + 45 * MINUTE_MS;
    // Keep the synthetic slots disjoint, as required by the tutor availability exclusion index.
    await prisma.availabilitySlot.update({
      where: { id: newSlotId },
      data: { endAtUtc: new Date(nextStart) },
    });
    const nextSlotId = await slot(nextStart);
    await prisma.booking.update({ where: { id: moving.id }, data: { slotId: nextSlotId } });
    const nextOccurrence = { ...moved, slotId: nextSlotId, startAtUtc: new Date(nextStart) };
    assert.deepEqual(await run(job, rescheduleDay), outcome(1, 1, 0));
    const occurrences = [...planned(moved, '1H'), ...planned(nextOccurrence, '1H')].sort();
    assert.deepEqual(await stored(moving), occurrences);
    assert.deepEqual(await run(otherJob, rescheduleDay), outcome(1, 0, 1));
    await assertRows(
      'same-band reschedule then repeat',
      nextOccurrence,
      rescheduleDay,
      occurrences,
    );
    pass('rescheduled occurrences in the same band keep separate keys and each recipient once');

    const catchUp = await booking(scenarioDay(12) + 12 * HOUR_MS);
    const catchUpStart = catchUp.startAtUtc.getTime();
    assert.deepEqual(await run(job, catchUpStart - 2 * HOUR_MS), outcome(1, 1, 0));
    await assertRows(
      'first run at 2h',
      catchUp,
      catchUpStart - 2 * HOUR_MS,
      planned(catchUp, '24H'),
    );
    const restarted = (await jobFor(otherPrisma)).get(ReminderJobService);
    assert.deepEqual(await run(restarted, catchUpStart - 30 * MINUTE_MS), outcome(1, 1, 0));
    const catchUpPairs = [...planned(catchUp, '24H'), ...planned(catchUp, '1H')].sort();
    await assertRows('restart at 30m', catchUp, catchUpStart - 30 * MINUTE_MS, catchUpPairs);

    // The actual inbox service reads job-written rows, including both recipients and both bands.
    const inbox = new NotificationsService(prisma);
    const studentInbox = await inbox.list(studentId, { limit: 50 });
    const tutorInbox = await inbox.list(tutorId, { limit: 50 });
    const studentReminders = studentInbox.items.filter((item) => item.bookingId === catchUp.id);
    const tutorReminders = tutorInbox.items.filter((item) => item.bookingId === catchUp.id);
    assert.deepEqual(studentReminders.map((item) => item.eventType).sort(), [
      'PAYMENT_REMINDER_1H',
      'PAYMENT_REMINDER_24H',
    ]);
    assert.deepEqual(tutorReminders, []);
    const unread = studentReminders[0];
    assert.ok(unread);
    assert.equal(unread.readAt, null);
    assert.match(unread.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    const receipt = await inbox.markRead(studentId, unread.id);
    const beforeRetry = await prisma.notification.findMany({
      where: { bookingId: catchUp.id },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(await run(restarted, catchUpStart - 29 * MINUTE_MS), outcome(1, 0, 1));
    assert.deepEqual(await run(restarted, catchUpStart), outcome(0, 0, 0));
    assert.deepEqual(await run(restarted, catchUpStart + 1), outcome(0, 0, 0));
    assert.deepEqual(
      await prisma.notification.findMany({
        where: { bookingId: catchUp.id },
        orderBy: { id: 'asc' },
      }),
      beforeRetry,
    );
    const readInbox = await inbox.list(studentId, { limit: 50 });
    assert.equal(readInbox.items.find((item) => item.id === unread.id)?.readAt, receipt.readAt);
    assert.equal(readInbox.unreadCount, studentInbox.unreadCount - 1);
    await assertRows('repeat then start + 1ms', catchUp, catchUpStart + 1, catchUpPairs);
    pass(
      '2h catch-up then a restarted worker at 30m: both bands, inbox ownership and stable read receipts',
    );

    // 10. Keyset paging over 210 bookings with three-way start-time ties loses and repeats none.
    const pagingDay = scenarioDay(10);
    const pagingSlots = tutorIds.flatMap((owner) =>
      Array.from({ length: 70 }, (_, index) => ({
        id: randomUUID(),
        tutorProfileId: owner,
        startAtUtc: new Date(pagingDay + HOUR_MS + index * 10 * MINUTE_MS),
        endAtUtc: new Date(pagingDay + HOUR_MS + (index + 1) * 10 * MINUTE_MS),
      })),
    );
    await prisma.availabilitySlot.createMany({ data: pagingSlots });
    await prisma.booking.createMany({
      data: pagingSlots.map((item) => ({
        studentUserId: studentId,
        tutorProfileId: item.tutorProfileId,
        listingId: listingOf(item.tutorProfileId),
        slotId: item.id,
        status: BookingStatus.CONFIRMED,
        subtotalAmount: '450.00',
        netAmount: '450.00',
      })),
    });
    assert.deepEqual(await run(job, pagingDay), outcome(210, 210, 0));
    const perBooking = await prisma.notification.groupBy({
      by: ['bookingId'],
      where: { booking: { slotId: { in: pagingSlots.map(({ id }) => id) } } },
      _count: { _all: true },
    });
    assert.equal(perBooking.length, 210);
    assert.ok(perBooking.every((row) => row._count._all === 1));
    assert.deepEqual(await run(job, pagingDay), outcome(210, 0, 210));
    pass('210 bookings with tied start times page in 100s with no booking missed or repeated');

    // 11. A failing insert rolls back that booking only; the next run retries and succeeds.
    const failureDay = scenarioDay(11);
    const failing = await booking(failureDay + 10 * HOUR_MS);
    const healthy = await booking(failureDay + 12 * HOUR_MS);
    assert.match(failing.id, UUID);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${failingFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN RAISE EXCEPTION 'Reminder rollback probe' USING ERRCODE = '23514'; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${failingFunction}" AFTER INSERT ON "Notification" FOR EACH ROW
       WHEN (NEW."bookingId" = '${failing.id}'::uuid AND NEW."eventType" = 'PAYMENT_REMINDER_24H')
       EXECUTE FUNCTION "${failingFunction}"()`,
    );
    // @nestjs/testing prints errors only, so capture the job's own lines to check what it logs.
    const logged: string[] = [];
    const capture = (message: unknown): void => {
      logged.push(String(message));
    };
    Logger.overrideLogger({ log: capture, warn: capture, error: capture });
    assert.deepEqual(await run(job, failureDay), outcome(2, 1, 0, 1));
    await assertRows(
      'failure after payment insert rolls back the reminder',
      failing,
      failureDay,
      [],
    );
    await assertRows(
      'healthy booking survives neighbor failure',
      healthy,
      failureDay,
      planned(healthy, '24H'),
    );
    await dropFailureProbe();
    assert.deepEqual(await run(job, failureDay + MINUTE_MS), outcome(2, 1, 1));
    await assertRows(
      'retry after insert failure',
      failing,
      failureDay + MINUTE_MS,
      planned(failing, '24H'),
    );
    Logger.overrideLogger(['error']);
    for (const line of logged) {
      process.stdout.write(`LOG ${line}\n`);
    }
    assert.equal(logged.length, 3);
    assert.match(
      logged[0] ?? '',
      /^Reminder booking skipped \(\w+(\/P\d{4})?\); retrying next tick$/,
    );
    assert.equal(logged[1], 'Reminder run: scanned=2 created=1 duplicates=0 failed=1');
    assert.equal(logged[2], 'Reminder run: scanned=2 created=1 duplicates=1 failed=0');
    assert.ok(
      logged.every((line) => !UUID_ANYWHERE.test(line)),
      'Logs carry no IDs',
    );
    pass('an insert failure rolls back only its booking, logs only its class, and is retried');

    // Independent fresh bookings prevent an earlier successful tick from masking a wrong boundary.
    let scenario = 20;
    for (const paid of [false, true]) {
      for (const [label, delta, band] of [
        ['25h', 25 * HOUR_MS, null],
        ['24h + 1ms', DAY_MS + 1, null],
        ['24h', DAY_MS, '24H'],
        ['24h - 1ms', DAY_MS - 1, '24H'],
        ['1h + 1ms', HOUR_MS + 1, '24H'],
        ['1h', HOUR_MS, '1H'],
        ['1h - 1ms', HOUR_MS - 1, '1H'],
        ['0 + 1ms', 1, '1H'],
        ['0', 0, null],
        ['0 - 1ms', -1, null],
      ] as const) {
        const item = await booking(
          scenarioDay(scenario++) + 17 * HOUR_MS,
          BookingStatus.CONFIRMED,
          paid,
        );
        const now = item.startAtUtc.getTime() - delta;
        const expected = band ? planned(item, band, { payment: !paid }) : [];
        assert.deepEqual(await run(job, now), outcome(band ? 1 : 0, expected.length, 0));
        await assertRows(`${paid ? 'paid' : 'unpaid'} ${label}`, item, now, expected);
      }
    }
    pass(
      'fresh paid/unpaid bookings at every exact boundary and +/-1ms, including Bangkok midnight',
    );

    for (const status of [
      BookingStatus.PENDING,
      BookingStatus.COMPLETED,
      BookingStatus.CANCELED,
      BookingStatus.EXPIRED,
    ]) {
      for (const delta of [2 * HOUR_MS, 30 * MINUTE_MS]) {
        const item = await booking(scenarioDay(scenario++) + 12 * HOUR_MS, status);
        const now = item.startAtUtc.getTime() - delta;
        assert.deepEqual(await run(job, now), outcome(0, 0, 0));
        await assertRows(`${status} at ${delta / MINUTE_MS}m`, item, now, []);
      }
    }
    const lateOnly = await booking(scenarioDay(scenario++) + 12 * HOUR_MS);
    const lateOnlyNow = lateOnly.startAtUtc.getTime() - 30 * MINUTE_MS;
    assert.deepEqual(await run(restarted, lateOnlyNow), outcome(1, 1, 0));
    await assertRows(
      'restart first sees booking at 30m: 1H only',
      lateOnly,
      lateOnlyNow,
      planned(lateOnly, '1H'),
    );
    pass('every excluded status in both bands and a restarted worker with no 24H history');

    process.stdout.write('\nS3-T08 database evidence (all fixture IDs are synthetic).\n');
    process.stdout.write(`S=${studentId}; T=${tutorId}.\n`);
    process.stdout.write(
      'Each S/T:band:kind expands to (recipient, reminder:bookingId:slotId:startISO:band:kind).\n',
    );
    process.stdout.write(
      '| Case | Booking ID | Slot ID | Fake now UTC / Bangkok | Start UTC / Bangkok | Expected recipient:key suffix | Actual DB assertion |\n',
    );
    process.stdout.write('| --- | --- | --- | --- | --- | --- | --- |\n');
    process.stdout.write(evidence.join('\n') + '\n');

    process.stdout.write(`Passed ${passed} reminder job database checks.\n`);
  } finally {
    try {
      await dropFailureProbe();
      await prisma.notification.deleteMany({ where: { userId: { in: users } } });
      await prisma.booking.deleteMany({ where: { tutorProfileId: { in: [...tutorIds] } } });
      await prisma.availabilitySlot.deleteMany({
        where: { tutorProfileId: { in: [...tutorIds] } },
      });
      await prisma.teachingListing.deleteMany({ where: { id: { in: [...listingIds.values()] } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: [...tutorIds] } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.subject.deleteMany({ where: { id: subjectId } });
      await prisma.gradeLevel.deleteMany({ where: { id: gradeId } });
    } finally {
      await Promise.allSettled(modules.map((moduleRef) => moduleRef.close()));
      await control.end();
      await otherPrisma.$disconnect();
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : 'Reminder job verification failed'}\n` +
        'Discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

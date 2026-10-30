import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import 'reflect-metadata';

import { AccountStatus, Role, TutorVerificationStatus } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { ConversationEvents } from '@modules/conversations/conversation-events';
import { DEFAULT_MESSAGES_PAGE_SIZE } from '@modules/conversations/conversations.dto';
import { ConversationsService } from '@modules/conversations/conversations.service';

/**
 * S2-T21: proves the S2-T19 message history/read-receipt contract against real PostgreSQL. The
 * mocked-Prisma suites (`conversations.service.spec.ts`, `conversations.controller.spec.ts`,
 * `conversations.e2e-spec.ts`) check the `where`/`orderBy` a call is given and the raw SQL *text*
 * `markMessagesRead` sends; they hand `findMany` whatever rows the test writes, so they can prove
 * the service asks the right question but not that walking `afterMessageId` across real inserted
 * rows -- including two genuinely tied on `sentAt`, which only the `id` half of the compound
 * `(sentAt, id)` tie-break can place correctly across a page boundary -- is actually gap-free and
 * duplicate-free; that the `readAt IS NULL` guard really makes a second read-receipt call a no-op
 * against a row Postgres has already written; or that a message sent with a near-future `sentAt`
 * doesn't trip `Message_read_time_check` (`readAt IS NULL OR readAt >= sentAt`) once a real
 * transaction tries to satisfy it. Only a real database can.
 *
 * `pageSize`/cursor format validation returning 400 is NOT re-proven here: `@Min`/`@Max`/`@IsUUID`
 * reject those before any query is built, so they are pure-pipe behavior already covered by
 * `conversations.dto.spec.ts` and, through the real HTTP validation pipe, by
 * `conversations.e2e-spec.ts`. A cursor that *is* a well-formed UUID but belongs to a different,
 * real, persisted conversation is a genuine database question, and is covered below instead.
 */

const databaseUrl = process.env['DATABASE_URL'];
assert.ok(databaseUrl, 'DATABASE_URL is required');
assert.equal(
  process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
  '1',
  'Explicit disposable database opt-in is required',
);
let parsed: URL;
try {
  parsed = new URL(databaseUrl);
} catch {
  throw new Error('DATABASE_URL must be a valid disposable PostgreSQL URL');
}
assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol), 'PostgreSQL is required');
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname),
  'Verification refuses remote databases',
);
assert.match(
  decodeURIComponent(parsed.pathname.slice(1)),
  /^hktutor[-_].*[-_]test$/,
  'Use a disposable hktutor_*_test database',
);
assert.equal(parsed.search, '', 'Database URL options/schema overrides are not allowed');
assert.equal(parsed.hash, '', 'Database URL fragments are not allowed');

const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
const conversations = new ConversationsService(prisma, new ConversationEvents());

const MESSAGE_COUNT = 35;
// Deliberately the service's own default (conversations.dto.ts), so a caller who never specifies
// pageSize exercises this exact walk; two pages of 20, so it needs exactly ceil(35/20) = 2 requests.
// A second walk below uses 7 instead, an exact divisor of 35, to reach the one page boundary this
// size can never produce: the look-ahead row count landing on exactly pageSize.
const PAGE_SIZE = 20;
assert.equal(
  PAGE_SIZE,
  DEFAULT_MESSAGES_PAGE_SIZE,
  'keep PAGE_SIZE in sync with the service default',
);
const EXACT_DIVISOR_PAGE_SIZE = 7;

const created = {
  users: [] as string[],
};

let passed = 0;
function pass(label: string): void {
  passed += 1;
  process.stdout.write(`PASS [real PostgreSQL] ${label}\n`);
}

async function createTutor(displayName: string): Promise<string> {
  const userId = randomUUID();
  created.users.push(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@s2-t21.invalid`,
      role: Role.TUTOR,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.tutorProfile.create({
    data: {
      userId,
      displayName,
      bio: 'Synthetic fixture for S2-T21',
      experienceYears: 3,
      verificationStatus: TutorVerificationStatus.VERIFIED,
    },
  });
  return userId;
}

async function createStudent(nickname: string): Promise<string> {
  const userId = randomUUID();
  created.users.push(userId);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@s2-t21.invalid`,
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.studentProfile.create({
    data: {
      userId,
      firstName: 'Synthetic',
      lastName: nickname,
      nickname,
      school: 'S2-T21 Fixture School',
      gradeLevel: 'Grade 10',
      phone: '0000000000',
    },
  });
  return userId;
}

/** Opens a conversation through the real service, exercising the real pair-resolution once per
 * fixture rather than inserting the row directly. */
async function openPair(studentUserId: string, tutorUserId: string): Promise<string> {
  const { conversation } = await conversations.openConversation({
    role: Role.STUDENT,
    tutorId: tutorUserId,
    userId: studentUserId,
  });
  return conversation.conversationId;
}

/** Sends one real message per entry of `sentAtValues`, at exactly that timestamp -- deterministic
 * regardless of how fast the script executes, and able to express a genuine tie (two entries with
 * the identical instant). Returns each row's real `id` and `sentAt`. */
async function sendMessagesAt(
  conversationId: string,
  senderUserId: string,
  sentAtValues: Date[],
  textPrefix: string,
): Promise<Array<{ id: string; sentAt: Date }>> {
  const rows: Array<{ id: string; sentAt: Date }> = [];
  for (const [index, sentAt] of sentAtValues.entries()) {
    const sent = await prisma.message.create({
      data: {
        clientMessageId: randomUUID(),
        conversationId,
        senderUserId,
        text: `${textPrefix}-${index + 1}`,
        sentAt,
      },
      select: { id: true, sentAt: true },
    });
    rows.push(sent);
  }
  return rows;
}

/** The server's real tie-break is `(sentAt ASC, id ASC)`; deriving the expected order this way,
 * rather than assuming send order, is what makes the tie below a meaningful check instead of an
 * assumption about which of two equally-timestamped rows the database happens to return first. */
function expectedReadOrder(rows: Array<{ id: string; sentAt: Date }>): string[] {
  return [...rows]
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime() || (a.id < b.id ? -1 : 1))
    .map((row) => row.id);
}

/** `exactOptionalPropertyTypes` rejects an explicit `afterMessageId: undefined`, so the key is
 * included only when there truly is a cursor to send -- the same thing a real HTTP client does by
 * omitting a query parameter rather than sending it empty. */
function readAsTutor(
  conversationId: string,
  tutorUserId: string,
  options: { afterMessageId?: string | undefined; pageSize?: number | undefined } = {},
) {
  return conversations.getMessages({
    conversationId,
    userId: tutorUserId,
    ...(options.afterMessageId === undefined ? {} : { afterMessageId: options.afterMessageId }),
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
  });
}

interface ForwardWalk {
  collected: string[];
  pageCount: number;
  hasMoreSequence: boolean[];
  finalCursor: string | undefined;
}

/** Walks every page forward from the start, using only the cursor the server itself returns. */
async function walkForward(
  conversationId: string,
  tutorUserId: string,
  pageSize: number,
): Promise<ForwardWalk> {
  const collected: string[] = [];
  const hasMoreSequence: boolean[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  let pageCount = 0;
  while (hasMore) {
    const page = await readAsTutor(conversationId, tutorUserId, {
      afterMessageId: cursor,
      pageSize,
    });
    pageCount += 1;
    assert.ok(pageCount <= 20, 'runaway pagination: hasMore never settled to false');
    collected.push(...page.items.map((item) => item.messageId));
    hasMore = page.hasMore;
    hasMoreSequence.push(hasMore);
    cursor = page.nextAfterMessageId ?? undefined;
  }
  return { collected, pageCount, hasMoreSequence, finalCursor: cursor };
}

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    const target = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(parsed.pathname.slice(1)), schema: 'public' },
    ]);
    const committedMigrations = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
    >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    const applied = new Set(
      migrations
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    );
    assert.deepEqual(
      committedMigrations.filter((name) => !applied.has(name)),
      [],
      'Apply all committed migrations before verification',
    );
    assert.equal(
      migrations.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
      'Resolve unfinished migrations before verification',
    );

    const tutor = await createTutor('Pagination Tutor');
    const student = await createStudent('Pagination Student');
    const conversationId = await openPair(student, tutor);

    // A second, unrelated conversation with its own messages: proves pagination and read receipts
    // on the first conversation never leak into or read from the second, and that a well-formed
    // cursor pointing at a real message in a DIFFERENT conversation is rejected rather than
    // silently accepted. A mocked `findFirst` can only return what the test tells it to; it cannot
    // forget a `conversationId` filter the way a real query against two real conversations would
    // expose.
    const otherTutor = await createTutor('Other Conversation Tutor');
    const otherStudent = await createStudent('Other Conversation Student');
    const otherConversationId = await openPair(otherStudent, otherTutor);
    const [decoyMessage] = await sendMessagesAt(
      otherConversationId,
      otherStudent,
      [new Date()],
      'decoy',
    );
    assert.ok(decoyMessage, 'the decoy conversation must have sent its one message');
    const decoyMessageId = decoyMessage.id;

    // 1. Sender reopen: the student sends all 35 messages, then immediately reopens their own
    // conversation and calls markMessagesRead as themselves. None of their own messages may become
    // read -- read receipts track the recipient, not the sender.
    //
    // Messages 20 and 21 are deliberately sent at the EXACT same instant, straddling the default
    // page-size-20 boundary: whichever of the two sorts second needs the server's (sentAt, id)
    // tie-break to be read back after a cursor whose sentAt is identical to its own, not just
    // later. A real gap here -- unlike a mocked findMany, which returns whatever rows the test
    // hands it regardless of the WHERE clause -- can only be produced by a real query.
    //
    // `base` is anchored in the past, not at Date.now(): every one of these 35 timestamps must
    // already be behind the real wall clock by the time markMessagesRead reads it below, or
    // GREATEST(now(), sentAt) and a buggy "just use sentAt" would be indistinguishable -- both
    // would resolve to the same stored sentAt, and step 5's readAt assertions could not tell them
    // apart. Only the one deliberately-skewed message near the end of this script is future-dated.
    const base = Date.now() - 10 * 60 * 1000;
    // The tie straddles the PAGE_SIZE boundary by construction, not by a hard-coded 19/20: the
    // message AT the boundary (index PAGE_SIZE - 1) and the one right after it (index PAGE_SIZE)
    // both land on tiedInstant, so the pair stays at the boundary even if PAGE_SIZE changes above.
    const tieIndexA = PAGE_SIZE - 1;
    const tieIndexB = PAGE_SIZE;
    const tiedInstant = new Date(base + (tieIndexA + 1) * 1000);
    const sentAtValues = Array.from({ length: MESSAGE_COUNT }, (_, index) =>
      index === tieIndexA || index === tieIndexB
        ? tiedInstant
        : new Date(base + (index + 1) * 1000),
    );
    const sentRows = await sendMessagesAt(conversationId, student, sentAtValues, 'm');
    const sentIds = expectedReadOrder(sentRows);
    const senderReopen = await conversations.markMessagesRead({
      conversationId,
      userId: student,
    });
    assert.equal(senderReopen.updatedCount, 0, 'a sender reopening must mark nothing of their own');
    assert.equal(senderReopen.readAt, null);
    const afterSenderReopen = await prisma.message.findMany({
      where: { conversationId },
      select: { readAt: true },
    });
    assert.ok(
      afterSenderReopen.every((row) => row.readAt === null),
      'every one of the sender’s own messages must stay unread after their own reopen',
    );
    pass('a sender reopening their own conversation marks nothing and leaves all 35 unread');

    // 2. Paginate forward from the start to the real end: no gaps, no duplicates, in send order,
    // walking only the cursor the server itself returns.
    const defaultSizeWalk = await walkForward(conversationId, tutor, PAGE_SIZE);
    assert.equal(defaultSizeWalk.pageCount, 2, 'expected exactly ceil(35 / 20) = 2 pages');
    assert.deepEqual(
      defaultSizeWalk.collected,
      sentIds,
      'the walked page order must match send order with no gaps',
    );
    assert.equal(
      new Set(defaultSizeWalk.collected).size,
      MESSAGE_COUNT,
      'no message may be returned twice',
    );
    pass(
      'paginating afterMessageId/pageSize across 35 real messages, two of them tied on sentAt ' +
        'at the page boundary, returns every one exactly once',
    );

    // 2b. A page size that divides the message count with no remainder is the one case where the
    // look-ahead fetch (pageSize + 1 rows) can return exactly pageSize rows on the true last page,
    // rather than fewer: `hasMore` must still read false there, not true from an off-by-one on
    // `rows.length > pageSize`. 20 never produces this (35 % 20 != 0); 7 does (35 / 7 = 5 exactly).
    const exact = await walkForward(conversationId, tutor, EXACT_DIVISOR_PAGE_SIZE);
    assert.equal(exact.pageCount, 5, 'expected exactly 35 / 7 = 5 pages with no remainder');
    assert.deepEqual(
      exact.collected,
      sentIds,
      'a different page size must walk the same 35 messages',
    );
    assert.deepEqual(
      exact.hasMoreSequence,
      [true, true, true, true, false],
      'the fifth and final page must report hasMore: false even though it is exactly pageSize long',
    );
    pass(
      'a page size that evenly divides the message count still reports the last page as the last',
    );

    // 3. The end cursor is stable: polling again with it returns nothing new and the same cursor,
    // which is what lets a client re-poll it safely.
    const cursor = defaultSizeWalk.finalCursor;
    const atEnd = await readAsTutor(conversationId, tutor, { afterMessageId: cursor });
    assert.deepEqual(atEnd, { hasMore: false, items: [], nextAfterMessageId: cursor });
    pass('polling the end cursor again returns an empty page and keeps the same cursor');

    // 4. A well-formed cursor that is a real message, just not one in this conversation, is
    // rejected -- not silently treated as "no cursor" and not found by accident.
    await assert.rejects(
      conversations.getMessages({
        afterMessageId: decoyMessageId,
        conversationId,
        userId: tutor,
      }),
      { message: 'afterMessageId must be a message in this conversation.' },
    );
    pass('a real message ID from a different conversation is rejected as a cursor, not accepted');

    // 5. The recipient marks every unread message read, exactly once, with a real readAt. Two
    // different stored shapes must both be true at once, and only GREATEST(now(), sentAt) produces
    // both. This compares database-returned values against each other only, never a column against
    // this script's own Date.now(): comparing across the Node and PostgreSQL clocks (two different
    // hosts under Docker) would leave only a few milliseconds of slack and risk a false failure from
    // ordinary clock drift.
    //
    // A single raw UPDATE's now() is constant for the whole statement, so the 35 past-dated
    // messages -- which have 34 different sentAt values one second apart -- must all be read back
    // sharing the exact same readAt: if each one's readAt instead matched its own distinct sentAt,
    // that would surface directly as more than one distinct value, with no clock comparison needed.
    // The one message with a sentAt the database clock has not yet reached -- which could arise from
    // clock drift between hosts, or a row written outside the normal sendMessage path, not from a
    // client supplying its own sentAt -- must instead be read back at exactly that same sentAt,
    // since that is the only value satisfying Message_read_time_check for it. A "just use sentAt"
    // bug would pass the second half and produce 34 distinct values in the first; a "just use now()"
    // bug would pass the first and violate the check constraint on the second; neither survives both.
    const skewedId = (
      await prisma.message.create({
        data: {
          clientMessageId: randomUUID(),
          conversationId,
          senderUserId: student,
          text: 'not-yet-reached',
          sentAt: new Date(Date.now() + 60_000),
        },
        select: { id: true },
      })
    ).id;
    const firstRead = await conversations.markMessagesRead({ conversationId, userId: tutor });
    assert.equal(firstRead.updatedCount, MESSAGE_COUNT + 1, 'must mark all 35 plus the skewed one');
    assert.ok(firstRead.readAt);
    const readRows = await prisma.message.findMany({
      where: { conversationId, senderUserId: student },
      select: { id: true, readAt: true, sentAt: true },
    });
    assert.equal(readRows.length, MESSAGE_COUNT + 1);
    for (const row of readRows) {
      assert.ok(row.readAt, `message ${row.id} must have a readAt`);
      assert.ok(
        row.readAt >= row.sentAt,
        `message ${row.id}: readAt must never precede sentAt (Message_read_time_check)`,
      );
    }
    const skewedRow = readRows.find((row) => row.id === skewedId);
    assert.ok(skewedRow, 'the clock-skewed message must be one of the rows read back');
    assert.deepEqual(
      skewedRow.readAt,
      skewedRow.sentAt,
      'the message not yet reached by the database clock must be read at exactly its own sentAt',
    );
    const pastDatedReadAtValues = new Set(
      readRows.filter((row) => row.id !== skewedId).map((row) => row.readAt?.getTime()),
    );
    assert.equal(
      pastDatedReadAtValues.size,
      1,
      'all 35 past-dated messages must share one statement-wide now(), not their 34 distinct sentAt values',
    );
    pass(
      'the recipient marks all unread messages read with one shared database-clock timestamp, ' +
        'except the one message the clock has not yet reached, which keeps exactly its own sentAt',
    );

    // 6. Repeating the read receipt call is a true no-op against the rows Postgres already wrote:
    // zero rows touched and the stored readAt values are byte-for-byte unchanged, not re-stamped.
    const beforeRepeat = new Map(readRows.map((row) => [row.id, row.readAt]));
    const secondRead = await conversations.markMessagesRead({ conversationId, userId: tutor });
    assert.equal(secondRead.updatedCount, 0, 'a repeated read receipt call must touch nothing');
    assert.equal(secondRead.readAt, null);
    const afterRepeat = await prisma.message.findMany({
      where: { conversationId, senderUserId: student },
      select: { id: true, readAt: true },
    });
    for (const row of afterRepeat) {
      assert.deepEqual(
        row.readAt,
        beforeRepeat.get(row.id),
        `message ${row.id}: a repeated read receipt must not move an already-set readAt`,
      );
    }
    pass('repeating the read receipt call marks nothing and leaves every stored readAt untouched');

    // 7. The second conversation was never touched by any of the above.
    const decoyAfter = await prisma.message.findUniqueOrThrow({
      where: { id: decoyMessageId },
      select: { readAt: true },
    });
    assert.equal(decoyAfter.readAt, null, 'the unrelated conversation must stay fully untouched');
    pass('an unrelated conversation is never read from or written to by this one’s operations');

    new Logger('MessagePagination').log(`${passed} checks passed`);
  } finally {
    try {
      await prisma.message.deleteMany({
        where: { senderUserId: { in: created.users } },
      });
      await prisma.conversation.deleteMany({
        where: {
          OR: [{ studentUserId: { in: created.users } }, { tutorUserId: { in: created.users } }],
        },
      });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.studentProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : 'Message pagination verification failed'}\n`,
  );
  process.exitCode = 1;
});

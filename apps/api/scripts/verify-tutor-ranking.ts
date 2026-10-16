import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import 'reflect-metadata';

import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorRankingPriority, TutorRecommendationTag } from '@modules/tutors/tutor-ranking';
import { MAX_TUTOR_SEARCH_PAGE_SIZE } from '@modules/tutors/tutors.dto';

/**
 * S2-T15: proves the S2-T13 ranking engine against real PostgreSQL. The mocked-Prisma suites
 * (`tutor-ranking.spec.ts`, `tutor-ranking-explanations.service.spec.ts`,
 * `public-tutors.service.spec.ts`, `tutor-ranking-contract.e2e-spec.ts`) check the `orderBy`/SQL a
 * call is given and the pure tag function in isolation; none of them execute a query against a real
 * engine, so none can certify that the raw `$queryRaw` used for `earliest_availability` -- its
 * `LEFT JOIN`, `NOT EXISTS` booking subquery and `deletedAt` filter -- actually orders rows
 * correctly; that a tutor with no bookable future slot (no slot rows, only a past one, or only one
 * blocked by a pending/confirmed booking) truly sorts last while one blocked only by a *canceled*
 * booking does not; that the subject filter survives on that same hand-written SQL path, not just
 * the Prisma-built one; or that a real stored `Decimal` price, not an in-memory one, is compared
 * correctly against `maxPrice`. Only a real database can. S2-T14's ranking selector and result-card
 * tags have since merged (`apps/web/e2e/tutor-search-ui.spec.ts` covers filter retention and tag
 * rendering on the UI side); ordering, the 400 response and the truth of each tag are all decided
 * here, server-side, with the UI only rendering what this endpoint returns, so this verification
 * stays scoped to the API contract.
 *
 * `priority=<invalid>` returning 400 is NOT re-proven here: `resolveTutorRankingQuery` rejects it
 * before any query is built, so it is pure-function behavior already covered by
 * `tutor-ranking.spec.ts` and, through the real HTTP validation pipe, by
 * `tutor-ranking-contract.e2e-spec.ts`. Fabricating database evidence for a path that never reaches
 * the database would not strengthen that proof.
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
const directory = new TutorDirectoryService(prisma);

const created = {
  users: [] as string[],
  bookings: [] as string[],
  slots: [] as string[],
  listings: [] as string[],
  subjects: [] as string[],
  grades: [] as string[],
};

let passed = 0;
function pass(label: string): void {
  passed += 1;
  process.stdout.write(`PASS [real PostgreSQL] ${label}\n`);
}

function daysFromNow(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

interface TutorFixture {
  userId: string;
  listingId: string;
}

/** Creates one VERIFIED, ACTIVE tutor with a single PUBLISHED listing, bypassing the publish
 * workflow (that gate is S2-T10's contract, proven by `db:verify:tutor-verification`) so this
 * fixture is deterministic regardless of execution speed. */
async function createRankedTutor(input: {
  displayName: string;
  subjectId: string;
  gradeLevelId: string;
  price: string;
  rating: string | null;
  publishedAt: Date;
}): Promise<TutorFixture> {
  const userId = randomUUID();
  const listingId = randomUUID();
  created.users.push(userId);
  created.listings.push(listingId);

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@s2-t15.invalid`,
      role: Role.TUTOR,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.tutorProfile.create({
    data: {
      userId,
      displayName: input.displayName,
      bio: 'Synthetic fixture for S2-T15',
      experienceYears: 3,
      ratingAverage: input.rating,
      verificationStatus: TutorVerificationStatus.VERIFIED,
    },
  });
  await prisma.teachingListing.create({
    data: {
      id: listingId,
      tutorProfileId: userId,
      subjectId: input.subjectId,
      gradeLevelId: input.gradeLevelId,
      pricePerHour: input.price,
      description: `Synthetic listing for ${input.displayName}.`,
      publicationStatus: ListingPublicationStatus.PUBLISHED,
      publishedAt: input.publishedAt,
    },
  });

  return { userId, listingId };
}

/** A bookable future slot: real rows a student could actually reserve. */
async function addOpenSlot(tutorProfileId: string, startAtUtc: Date): Promise<void> {
  const id = randomUUID();
  created.slots.push(id);
  await prisma.availabilitySlot.create({
    data: {
      id,
      tutorProfileId,
      startAtUtc,
      endAtUtc: new Date(startAtUtc.getTime() + 60 * 60 * 1000),
    },
  });
}

/**
 * A future slot that exists but is not bookable, through either live path: already reserved by a
 * pending/confirmed booking, or soft-deleted. Both filters must hold for the row to be correctly
 * excluded, so this one fixture catches a regression in either half of the raw query's `WHERE`.
 */
async function addUnbookableSlots(
  tutor: TutorFixture,
  studentUserId: string,
  listingId: string,
  startAtUtc: Date,
): Promise<void> {
  const reservedSlotId = randomUUID();
  const deletedSlotId = randomUUID();
  created.slots.push(reservedSlotId, deletedSlotId);
  await prisma.availabilitySlot.create({
    data: {
      id: reservedSlotId,
      tutorProfileId: tutor.userId,
      startAtUtc,
      endAtUtc: new Date(startAtUtc.getTime() + 60 * 60 * 1000),
    },
  });
  await prisma.availabilitySlot.create({
    data: {
      id: deletedSlotId,
      tutorProfileId: tutor.userId,
      startAtUtc: new Date(startAtUtc.getTime() + 2 * 60 * 60 * 1000),
      endAtUtc: new Date(startAtUtc.getTime() + 3 * 60 * 60 * 1000),
      deletedAt: new Date(),
    },
  });
  const bookingId = randomUUID();
  created.bookings.push(bookingId);
  await prisma.booking.create({
    data: {
      id: bookingId,
      studentUserId,
      tutorProfileId: tutor.userId,
      listingId,
      slotId: reservedSlotId,
      status: BookingStatus.CONFIRMED,
      subtotalAmount: '999.00',
      netAmount: '999.00',
    },
  });
}

/**
 * A future slot with a CANCELED booking attached: the booking must NOT block it, unlike a
 * pending/confirmed one. Catches a regression that treats any booking at all, canceled included,
 * as reserving the slot.
 */
async function addSlotWithCanceledBooking(
  tutor: TutorFixture,
  studentUserId: string,
  listingId: string,
  startAtUtc: Date,
): Promise<void> {
  const slotId = randomUUID();
  created.slots.push(slotId);
  await prisma.availabilitySlot.create({
    data: {
      id: slotId,
      tutorProfileId: tutor.userId,
      startAtUtc,
      endAtUtc: new Date(startAtUtc.getTime() + 60 * 60 * 1000),
    },
  });
  const bookingId = randomUUID();
  created.bookings.push(bookingId);
  await prisma.booking.create({
    data: {
      id: bookingId,
      studentUserId,
      tutorProfileId: tutor.userId,
      listingId,
      slotId,
      status: BookingStatus.CANCELED,
      subtotalAmount: '999.00',
      netAmount: '999.00',
      canceledById: studentUserId,
      cancellationReason: 'Synthetic cancellation for S2-T15 fixture.',
      canceledAt: new Date(),
    },
  });
}

/** Filters a full, unpaginated search result down to our own fixtures, in the order the server
 * returned them -- tolerant of a disposable database that is not perfectly empty. */
function ours<T extends { listingId: string }>(items: T[], ids: Set<string>): T[] {
  return items.filter((item) => ids.has(item.listingId));
}

async function searchByPriority(subject: string, priority: TutorRankingPriority) {
  return directory.searchPublicTutors({
    pageSize: MAX_TUTOR_SEARCH_PAGE_SIZE,
    priority,
    subject,
  });
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

    const now = new Date();
    // Random, not a fixed literal: `Subject.name` is unique, and a fixed name would collide with
    // stale rows left behind by a run that crashed before its own cleanup ran.
    const subjectName = randomUUID();
    const otherSubjectName = randomUUID();
    const subject = await prisma.subject.create({
      data: { id: randomUUID(), code: randomUUID(), name: subjectName },
    });
    const otherSubject = await prisma.subject.create({
      data: { id: randomUUID(), code: randomUUID(), name: otherSubjectName },
    });
    const grade = await prisma.gradeLevel.create({
      data: { id: randomUUID(), code: randomUUID(), name: randomUUID(), sortOrder: 1 },
    });
    created.subjects.push(subject.id, otherSubject.id);
    created.grades.push(grade.id);
    const student = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `${randomUUID()}@s2-t15.invalid`,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
      },
    });
    created.users.push(student.id);

    // Two tutors genuinely tied at the global-lowest price; a higher rating must break the tie and
    // rank first. publishedAt deliberately disagrees with rating here (A is the more recently
    // published of the two) so a regression that silently fell back to the trailing publishedAt
    // tie-break, instead of the named price mode's own rating tie-break, would rank them the wrong
    // way round and be caught, rather than passing by coincidence.
    const tiedLowA = await createRankedTutor({
      displayName: 'Tied Lowest, Lower Rating, More Recently Published',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '200.00',
      rating: '4.50',
      publishedAt: daysFromNow(now, -5),
    });
    const tiedLowB = await createRankedTutor({
      displayName: 'Tied Lowest, Higher Rating, Published Earlier',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '200.00',
      rating: '4.90',
      publishedAt: daysFromNow(now, -39),
    });
    // Tied with tiedLowB at the global-highest rating; a later publishedAt must break the tie and
    // rank first, since the named rating priority defines no other secondary dimension.
    const tiedHigh = await createRankedTutor({
      displayName: 'Tied Highest Rating, Recently Published',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '350.00',
      rating: '4.90',
      publishedAt: daysFromNow(now, -10),
    });
    // Unrated: must never be mistaken for a 0 and must never carry the highest-rated tag.
    const unrated = await createRankedTutor({
      displayName: 'Unrated',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '500.00',
      rating: null,
      publishedAt: daysFromNow(now, -40),
    });
    // Same price and rating as the no-slot tutor below; having any real future slot at all must
    // still outrank having none, regardless of how distant that slot is.
    const laterSlotTwin = await createRankedTutor({
      displayName: 'Later Slot, Otherwise Tied With the No-Slot Tutor',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '999.00',
      rating: '3.00',
      publishedAt: daysFromNow(now, -40),
    });
    const noSlot = await createRankedTutor({
      displayName: 'No Bookable Future Slot',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '999.00',
      rating: '3.00',
      publishedAt: daysFromNow(now, -40),
    });
    // Wins every single priority, but on the other subject: must never appear once a subject
    // filter is applied, proving a ranking change cannot widen or drop an existing filter.
    const otherSubjectWinner = await createRankedTutor({
      displayName: 'Other Subject Winner',
      subjectId: otherSubject.id,
      gradeLevelId: grade.id,
      price: '1.00',
      rating: '5.00',
      publishedAt: daysFromNow(now, -40),
    });
    // Catches dropping `slot."startAtUtc" > ${now}` from the raw query: this tutor's only slot is
    // in the past, so it must count as having no bookable future slot at all, the same as noSlot,
    // not as an available one with an impossibly early time.
    const pastOnlySlot = await createRankedTutor({
      displayName: 'Only A Past Slot',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '999.00',
      rating: '3.00',
      publishedAt: daysFromNow(now, -41),
    });
    // Catches dropping the booking-status filter so that any booking at all, canceled included,
    // blocks a slot: a canceled booking must leave the slot bookable and sorted normally.
    const canceledBookingSlot = await createRankedTutor({
      displayName: 'Future Slot With A Canceled Booking',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '999.00',
      rating: '3.00',
      publishedAt: daysFromNow(now, -40),
    });
    // Priced one satang above tiedLowA/B's 200.00: proves the real stored Decimal column, not just
    // the in-memory comparison the mocked suites exercise, correctly excludes it from a
    // maxPrice=200.00 filter.
    const budgetBoundaryPeer = await createRankedTutor({
      displayName: 'One Satang Above The Budget Boundary',
      subjectId: subject.id,
      gradeLevelId: grade.id,
      price: '200.01',
      rating: '3.00',
      publishedAt: daysFromNow(now, -40),
    });

    await addOpenSlot(tiedLowA.userId, daysFromNow(now, 3));
    await addOpenSlot(tiedLowB.userId, daysFromNow(now, 5));
    await addOpenSlot(tiedHigh.userId, daysFromNow(now, 1));
    await addOpenSlot(unrated.userId, daysFromNow(now, 2));
    await addOpenSlot(laterSlotTwin.userId, daysFromNow(now, 4));
    // Timestamp deliberately distinct from every other slot above, and deliberately NOT at the
    // start or end of the real ordering: if this reserved slot ever leaked as available, it would
    // land in a visibly different, middle position (between tiedHigh and unrated) rather than
    // landing coincidentally wherever "no slot" already sorts -- which a timestamp placed at
    // either end of the range would risk doing by accident.
    await addUnbookableSlots(noSlot, student.id, noSlot.listingId, daysFromNow(now, 1.5));
    await addOpenSlot(otherSubjectWinner.userId, new Date(now.getTime() + 60 * 60 * 1000));
    await addOpenSlot(pastOnlySlot.userId, daysFromNow(now, -2));
    await addSlotWithCanceledBooking(
      canceledBookingSlot,
      student.id,
      canceledBookingSlot.listingId,
      daysFromNow(now, 2.5),
    );

    // The price/rating scenarios deliberately leave laterSlotTwin, noSlot and their new siblings
    // out: all are priced and rated identically (999.00 / 3.00), so their own relative order is an
    // incidental publishedAt/id tie-break, not something either scenario is asserting about.
    const priceRatingGroupIds = new Set(
      [tiedLowA, tiedLowB, tiedHigh, unrated].map((t) => t.listingId),
    );
    const availabilityGroupIds = new Set(
      [
        tiedHigh,
        unrated,
        canceledBookingSlot,
        tiedLowA,
        laterSlotTwin,
        tiedLowB,
        noSlot,
        pastOnlySlot,
      ].map((t) => t.listingId),
    );

    // 1. lowest_price: ascending by price; the two true co-winners keep the FITS_BUDGET-style
    // LOWEST_PRICE tag, and a higher rating breaks their tie rather than creation order.
    {
      const result = await searchByPriority(subjectName, TutorRankingPriority.LOWEST_PRICE);
      const relevant = ours(result.items, priceRatingGroupIds);
      assert.deepEqual(
        relevant.map((item) => item.listingId),
        [tiedLowB.listingId, tiedLowA.listingId, tiedHigh.listingId, unrated.listingId],
        'ascending price order with a rating-desc tie-break must not depend on creation order',
      );
      assert.ok(
        result.items.every((item) => item.listingId !== otherSubjectWinner.listingId),
        'the globally cheapest listing must stay excluded once the subject filter narrows it out',
      );
      const expectedTags: Record<string, TutorRecommendationTag[]> = {
        [tiedLowA.listingId]: [TutorRecommendationTag.LOWEST_PRICE],
        [tiedLowB.listingId]: [TutorRecommendationTag.LOWEST_PRICE],
        [tiedHigh.listingId]: [],
        [unrated.listingId]: [],
      };
      for (const item of relevant) {
        assert.deepEqual(
          item.recommendationTags,
          expectedTags[item.listingId],
          `recommendationTags must exactly match, not merely include, the expected set (${item.listingId})`,
        );
      }
      pass(
        'lowest_price ranks ascending, breaks a true price tie by rating, and tags both winners exactly',
      );

      // The tie itself straddles a page boundary at pageSize=1: the server must place exactly one
      // of the two on each page, with no duplicate and no skip, the way a real client paging one
      // result at a time would actually see it.
      const page1 = await directory.searchPublicTutors({
        page: 1,
        pageSize: 1,
        priority: TutorRankingPriority.LOWEST_PRICE,
        subject: subjectName,
      });
      const page2 = await directory.searchPublicTutors({
        page: 2,
        pageSize: 1,
        priority: TutorRankingPriority.LOWEST_PRICE,
        subject: subjectName,
      });
      assert.deepEqual(
        page1.items.map((item) => item.listingId),
        [tiedLowB.listingId],
      );
      assert.deepEqual(
        page2.items.map((item) => item.listingId),
        [tiedLowA.listingId],
      );
      pass('the price tie is split across a page boundary with no duplicate and no skip');
    }

    // 2. highest_rating: descending by rating; the tied pair sorts by publishedAt, the unrated
    // tutor sorts last under NULLS LAST and is never tagged.
    {
      const result = await searchByPriority(subjectName, TutorRankingPriority.HIGHEST_RATING);
      const relevant = ours(result.items, priceRatingGroupIds);
      assert.deepEqual(
        relevant.map((item) => item.listingId),
        [tiedHigh.listingId, tiedLowB.listingId, tiedLowA.listingId, unrated.listingId],
        'descending rating order with a publishedAt tie-break must not depend on creation order',
      );
      assert.equal(relevant.at(-1)?.listingId, unrated.listingId, 'a null rating must sort last');
      const expectedTags: Record<string, TutorRecommendationTag[]> = {
        [tiedHigh.listingId]: [TutorRecommendationTag.HIGHEST_RATED],
        [tiedLowB.listingId]: [TutorRecommendationTag.HIGHEST_RATED],
        [tiedLowA.listingId]: [],
        [unrated.listingId]: [],
      };
      for (const item of relevant) {
        assert.deepEqual(
          item.recommendationTags,
          expectedTags[item.listingId],
          `recommendationTags must exactly match, not merely include, the expected set (${item.listingId})`,
        );
      }
      pass(
        'highest_rating ranks descending, breaks a true rating tie, sorts a null rating last, ' +
          'and tags both winners exactly',
      );
    }

    // 3. earliest_availability: ascending by the earliest real bookable slot. A reserved-or-deleted
    // slot and a past-only slot must both count as no slot at all; a slot blocked only by a
    // CANCELED booking must count as a real one; and no-slot must sort after every tutor with a
    // real slot, even one whose price and rating are otherwise identical.
    {
      const result = await searchByPriority(
        subjectName,
        TutorRankingPriority.EARLIEST_AVAILABILITY,
      );
      const relevant = ours(result.items, availabilityGroupIds);
      assert.deepEqual(
        relevant.map((item) => item.listingId),
        [
          tiedHigh.listingId,
          unrated.listingId,
          canceledBookingSlot.listingId,
          tiedLowA.listingId,
          laterSlotTwin.listingId,
          tiedLowB.listingId,
          noSlot.listingId,
          pastOnlySlot.listingId,
        ],
        'availability order must interleave price/rating groups by actual slot time, with a ' +
          'canceled booking counted as available and a past-only slot counted as none, no-slot last',
      );
      const noSlotGroup = new Set(relevant.slice(-2).map((item) => item.listingId));
      assert.deepEqual(
        noSlotGroup,
        new Set([noSlot.listingId, pastOnlySlot.listingId]),
        'both the reserved/deleted-only tutor and the past-only tutor must land in the no-slot group',
      );
      const pastOnlyItem = relevant.find((item) => item.listingId === pastOnlySlot.listingId);
      assert.equal(
        pastOnlyItem?.nextAvailableAt,
        null,
        'a slot that only exists in the past must never surface as the next available time',
      );
      const expectedTags: Record<string, TutorRecommendationTag[]> = {
        [tiedHigh.listingId]: [TutorRecommendationTag.EARLIEST_AVAILABILITY],
        [unrated.listingId]: [],
        [canceledBookingSlot.listingId]: [],
        [tiedLowA.listingId]: [],
        [laterSlotTwin.listingId]: [],
        [tiedLowB.listingId]: [],
        [noSlot.listingId]: [],
        [pastOnlySlot.listingId]: [],
      };
      for (const item of relevant) {
        assert.deepEqual(
          item.recommendationTags,
          expectedTags[item.listingId],
          `recommendationTags must exactly match the expected set (${item.listingId})`,
        );
      }
      pass(
        'earliest_availability ranks by real bookable slots only, a canceled booking does not ' +
          'block one, a past-only slot counts as none, and tags match exactly',
      );

      // The other-subject tutor's slot (+1h) is chronologically earliest of all, ahead of even
      // tiedHigh's (+1d): if the raw query's subject filter ever leaked, it would win page 1
      // outright. The Prisma-built path already proves this for lowest_price above; this is the
      // one priority that bypasses Prisma's own `where` for a hand-written SQL WHERE instead.
      const leakCheck = await directory.searchPublicTutors({
        page: 1,
        pageSize: 1,
        priority: TutorRankingPriority.EARLIEST_AVAILABILITY,
        subject: subjectName,
      });
      assert.deepEqual(
        leakCheck.items.map((item) => item.listingId),
        [tiedHigh.listingId],
        'the other-subject tutor must never leak into the raw-SQL availability query, even on page 1',
      );
      pass(
        'the subject filter is retained on the raw-SQL availability path, not only the Prisma one',
      );
    }

    // 4. FITS_BUDGET against a real stored Decimal column: a price exactly at the budget is
    // included and tagged; one satang above it is excluded entirely by the real SQL filter, not
    // merely left untagged by the in-memory comparison the mocked suites exercise.
    {
      const result = await directory.searchPublicTutors({
        maxPrice: 200.0,
        pageSize: MAX_TUTOR_SEARCH_PAGE_SIZE,
        subject: subjectName,
      });
      assert.ok(
        result.items.every((item) => item.listingId !== budgetBoundaryPeer.listingId),
        'a price one satang above maxPrice must be excluded by the real database filter',
      );
      const relevant = ours(result.items, new Set([tiedLowA.listingId, tiedLowB.listingId]));
      assert.equal(relevant.length, 2, 'both tutors priced exactly at the budget must be included');
      for (const item of relevant) {
        assert.ok(
          item.recommendationTags.includes(TutorRecommendationTag.FITS_BUDGET),
          `a listing priced exactly at maxPrice must carry FITS_BUDGET (${item.listingId})`,
        );
      }
      pass(
        'a real stored price exactly at the budget is included and tagged; one satang above is not',
      );
    }

    new Logger('TutorRanking').log(`${passed} checks passed`);
  } finally {
    try {
      await prisma.booking.deleteMany({ where: { id: { in: created.bookings } } });
      await prisma.availabilitySlot.deleteMany({ where: { id: { in: created.slots } } });
      await prisma.teachingListing.deleteMany({ where: { id: { in: created.listings } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
      await prisma.subject.deleteMany({ where: { id: { in: created.subjects } } });
      await prisma.gradeLevel.deleteMany({ where: { id: { in: created.grades } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : 'Tutor ranking verification failed'}\n`,
  );
  process.exitCode = 1;
});

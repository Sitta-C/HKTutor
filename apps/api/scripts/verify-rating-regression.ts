import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';

import {
  AttendanceStatus,
  BookingStatus,
  ListingPublicationStatus,
  Prisma,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { ReviewsService } from '@modules/reviews/reviews.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorRankingPriority, TutorRecommendationTag } from '@modules/tutors/tutor-ranking';
import { MAX_TUTOR_SEARCH_PAGE_SIZE } from '@modules/tutors/tutors.dto';

import type { TutorSearchQueryDto } from '@modules/tutors/tutors.dto';

/**
 * S3-T20: US8-2 rating regression on real PostgreSQL. Every rating comes from a review created
 * through the real ReviewsService, then is read back through the real public detail and search
 * methods. Covers the approved 4.33 example (not the sheet's per-review-rounded 4.34), a fresh
 * review updating the count, exact 1 and 5 bounds, a single review, zero reviews and Unicode
 * feedback. Stale caches, concurrency, ties, paging and visibility are covered by the S3-T17
 * (db:verify:review-ratings) and S3-T19 (db:verify:search-ratings) verifiers.
 */

type Scores = readonly [clarity: number, punctuality: number, preparation: number];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FEEDBACK_CODE_POINTS = 1000;
const { HIGHEST_RATED } = TutorRecommendationTag;

export function disposableRatingRegressionDatabaseUrl(env: NodeJS.ProcessEnv): string {
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

/**
 * Exactly 1000 code points of Thai with stacked marks, a skin-tone ZWJ emoji, a combining accent
 * and markup-looking text. No whitespace, so the database's trim check cannot change it.
 */
export function unicodeFeedback(): string {
  const unit = 'ครูที่ดีมากๆ👩🏽‍🏫éé<b>&amp;</b>';
  const unitCodePoints = Array.from(unit).length;
  const codePoints = Array.from(unit.repeat(Math.ceil(FEEDBACK_CODE_POINTS / unitCodePoints)));
  return codePoints.slice(0, FEEDBACK_CODE_POINTS).join('');
}

interface Fixture {
  tutorId: string;
  listingId: string;
}

async function verify(): Promise<void> {
  const databaseUrl = disposableRatingRegressionDatabaseUrl(process.env);
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const directory = new TutorDirectoryService(prisma);
  const reviews = new ReviewsService(prisma);
  const now = Date.now();
  const gradeId = randomUUID();
  const reviewerId = randomUUID();
  const subjects: { id: string; name: string }[] = [];
  const tutors: string[] = [];
  let slotOffset = 0;
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [real services + PostgreSQL] ${label}\n`);
  };

  async function subject(): Promise<string> {
    const row = { id: randomUUID(), name: `s3-t20-${randomUUID()}` };
    await prisma.subject.create({ data: { ...row, code: row.id } });
    subjects.push(row);
    return row.name;
  }

  async function tutor(subjectName: string, price: string): Promise<Fixture> {
    const tutorId = randomUUID();
    const listingId = randomUUID();
    const subjectId = subjects.find(({ name }) => name === subjectName)?.id;
    assert.ok(subjectId);
    tutors.push(tutorId);
    await prisma.user.create({
      data: {
        id: tutorId,
        email: `${tutorId}@s3-t20.invalid`,
        role: Role.TUTOR,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutorId,
        displayName: 'Synthetic tutor',
        bio: 'S3-T20 rating regression fixture',
        experienceYears: 2,
        verificationStatus: TutorVerificationStatus.VERIFIED,
      },
    });
    await prisma.teachingListing.create({
      data: {
        id: listingId,
        tutorProfileId: tutorId,
        subjectId,
        gradeLevelId: gradeId,
        pricePerHour: price,
        description: 'Synthetic S3-T20 listing.',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date(now - DAY_MS),
      },
    });
    return { tutorId, listingId };
  }

  async function completedClass(fixture: Fixture): Promise<string> {
    const startAtUtc = new Date(now - 30 * DAY_MS - slotOffset++ * HOUR_MS * 2);
    const slot = await prisma.availabilitySlot.create({
      data: {
        tutorProfileId: fixture.tutorId,
        startAtUtc,
        endAtUtc: new Date(startAtUtc.getTime() + HOUR_MS),
      },
    });
    const booking = await prisma.booking.create({
      data: {
        studentUserId: reviewerId,
        tutorProfileId: fixture.tutorId,
        listingId: fixture.listingId,
        slotId: slot.id,
        status: BookingStatus.COMPLETED,
        subtotalAmount: '400.00',
        netAmount: '400.00',
        attendance: AttendanceStatus.ATTENDED,
        attendanceMarkedAt: new Date(startAtUtc.getTime() + 2 * HOUR_MS),
      },
    });
    return booking.id;
  }

  /** Submits a review the way the API does, returning that review's own rounded mean. */
  async function review(
    fixture: Fixture,
    [clarity, punctuality, preparation]: Scores,
    feedback = 'Synthetic review for S3-T20.',
  ): Promise<{ bookingId: string; overallRating: number }> {
    const bookingId = await completedClass(fixture);
    const created = await reviews.create(bookingId, reviewerId, {
      clarity,
      feedback,
      preparation,
      punctuality,
    });
    return { bookingId, overallRating: created.review.overallRating };
  }

  async function search(subjectName: string, query: TutorSearchQueryDto = {}) {
    return directory.searchPublicTutors({
      pageSize: MAX_TUTOR_SEARCH_PAGE_SIZE,
      subject: subjectName,
      ...query,
    });
  }

  /** The same tutor as the public detail endpoint, the search card and the cache row show it. */
  async function shown(fixture: Fixture, subjectName: string) {
    const detail = (await directory.getPublicTutor(fixture.tutorId)).tutor;
    const card = (await search(subjectName)).items.find(
      ({ listingId }) => listingId === fixture.listingId,
    );
    assert.ok(card, 'A visible tutor must appear in search');
    const cache = await prisma.tutorProfile.findUniqueOrThrow({
      select: { ratingAverage: true, reviewCount: true },
      where: { userId: fixture.tutorId },
    });
    return {
      card: [card.ratingAverage, card.reviewCount],
      cache: [cache.ratingAverage?.toFixed(2) ?? null, cache.reviewCount],
      detail: [detail.ratingAverage, detail.reviewCount],
    };
  }
  const everywhere = (average: number | null, count: number) => ({
    card: [average, count],
    cache: [average === null ? null : average.toFixed(2), count],
    detail: [average, count],
  });

  async function matching(subjectName: string, minimumRating: number): Promise<string[]> {
    return (await search(subjectName, { minimumRating })).items.map(({ listingId }) => listingId);
  }

  try {
    await prisma.$connect();
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

    await prisma.gradeLevel.create({
      data: { id: gradeId, code: gradeId, name: `s3-t20-${gradeId}`, sortOrder: 1 },
    });
    await prisma.user.create({
      data: {
        id: reviewerId,
        email: `${reviewerId}@s3-t20.invalid`,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
      },
    });

    // 1. The US8-2 example, one fresh review at a time.
    const example = await subject();
    const mali = await tutor(example, '350.00');
    assert.deepEqual(await shown(mali, example), everywhere(null, 0));
    const first = await review(mali, [5, 4, 5]);
    assert.equal(first.overallRating, 4.67);
    assert.deepEqual(await shown(mali, example), everywhere(4.67, 1));
    const second = await review(mali, [4, 4, 4]);
    assert.equal(second.overallRating, 4);
    assert.deepEqual(await shown(mali, example), everywhere(4.33, 2));
    // The sheet's wording averages the two rounded means: (4.67 + 4.00) / 2 = 4.335 -> 4.34.
    const roundedMeansFirst = new Prisma.Decimal(first.overallRating)
      .plus(second.overallRating)
      .dividedBy(2)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    assert.equal(roundedMeansFirst.toFixed(2), '4.34');
    assert.notEqual((await shown(mali, example)).detail[0], roundedMeansFirst.toNumber());
    assert.deepEqual(await matching(example, 4.33), [mali.listingId]);
    assert.deepEqual(await matching(example, 4.34), []);
    pass(
      '5/4/5 then 4/4/4: per-review 4.67 and 4.00, tutor 4.67/1 then 4.33/2 (not 4.34) on ' +
        'detail, search and cache; 4.33 includes, 4.34 excludes',
    );

    // 2. Exact bounds and a single review.
    const bounds = await subject();
    const allOnes = await tutor(bounds, '300.00');
    const allFives = await tutor(bounds, '310.00');
    const oneAndFive = await tutor(bounds, '320.00');
    const single = await tutor(bounds, '330.00');
    const fours = await tutor(bounds, '340.00');
    assert.equal((await review(allOnes, [1, 1, 1])).overallRating, 1);
    assert.equal((await review(allFives, [5, 5, 5])).overallRating, 5);
    await review(oneAndFive, [1, 1, 1]);
    await review(oneAndFive, [5, 5, 5]);
    assert.equal((await review(single, [5, 5, 4])).overallRating, 4.67);
    await review(fours, [4, 4, 4]);
    assert.deepEqual(await shown(allOnes, bounds), everywhere(1, 1));
    assert.deepEqual(await shown(allFives, bounds), everywhere(5, 1));
    assert.deepEqual(await shown(oneAndFive, bounds), everywhere(3, 2));
    assert.deepEqual(await shown(single, bounds), everywhere(4.67, 1));
    assert.deepEqual(await shown(fours, bounds), everywhere(4, 1));
    const sorted = (items: string[]) => [...items].sort();
    assert.deepEqual(
      sorted(await matching(bounds, 1)),
      sorted([allOnes, allFives, oneAndFive, single, fours].map(({ listingId }) => listingId)),
    );
    assert.deepEqual(await matching(bounds, 5), [allFives.listingId]);
    assert.deepEqual(
      sorted(await matching(bounds, 3)),
      sorted([allFives, oneAndFive, single, fours].map(({ listingId }) => listingId)),
    );
    assert.deepEqual(
      sorted(await matching(bounds, 3.01)),
      sorted([allFives, single, fours].map(({ listingId }) => listingId)),
    );
    assert.deepEqual(await matching(bounds, 4.67), [allFives.listingId]);
    const boundRanking = await search(bounds, { priority: TutorRankingPriority.HIGHEST_RATING });
    assert.deepEqual(
      boundRanking.items.map(({ listingId, recommendationTags }) => [
        listingId,
        recommendationTags,
      ]),
      [
        [allFives.listingId, [HIGHEST_RATED]],
        [single.listingId, []],
        [fours.listingId, []],
        [oneAndFive.listingId, []],
        [allOnes.listingId, []],
      ],
    );
    pass(
      '1/1/1 is 1.00 and passes 1; 5/5/5 is 5.00, the only one at 5 and HIGHEST_RATED; ' +
        '1/1/1 + 5/5/5 is exactly 3.00; one 5/5/4 review is 4.67, which 4.67 excludes',
    );

    // 3. Zero reviews: New tutor data, never a 0.00 rating.
    const fresh = await subject();
    const newcomer = await tutor(fresh, '200.00');
    const alone = await search(fresh, { priority: TutorRankingPriority.HIGHEST_RATING });
    assert.deepEqual(
      alone.items.map(({ ratingAverage, recommendationTags, reviewCount }) => [
        ratingAverage,
        reviewCount,
        recommendationTags,
      ]),
      [[null, 0, []]],
    );
    const rated = await tutor(fresh, '250.00');
    await review(rated, [3, 3, 3]);
    assert.deepEqual(await shown(newcomer, fresh), everywhere(null, 0));
    const withRated = await search(fresh, { priority: TutorRankingPriority.HIGHEST_RATING });
    assert.deepEqual(
      withRated.items.map(({ listingId, recommendationTags }) => [listingId, recommendationTags]),
      [
        [rated.listingId, [HIGHEST_RATED]],
        [newcomer.listingId, []],
      ],
    );
    assert.deepEqual(await matching(fresh, 1), [rated.listingId]);
    const cacheRow = await prisma.tutorProfile.findUniqueOrThrow({
      select: { ratingUpdatedAt: true },
      where: { userId: newcomer.tutorId },
    });
    assert.equal(cacheRow.ratingUpdatedAt, null);
    pass(
      'zero reviews: null/0 on detail, search and cache, sorted after a 3.00 tutor, never ' +
        'HIGHEST_RATED (even alone), and excluded by minimumRating=1',
    );

    // 4. Unicode feedback is stored exactly and does not change the rating.
    const unicode = await subject();
    const thaiFeedback = await tutor(unicode, '300.00');
    const asciiFeedback = await tutor(unicode, '300.00');
    const feedback = unicodeFeedback();
    assert.equal(Array.from(feedback).length, FEEDBACK_CODE_POINTS);
    assert.ok(feedback.length > FEEDBACK_CODE_POINTS, 'Fixture must contain astral code points');
    const unicodeBookings = [
      (await review(thaiFeedback, [5, 4, 5], feedback)).bookingId,
      (await review(thaiFeedback, [4, 4, 4], feedback)).bookingId,
    ];
    await review(asciiFeedback, [5, 4, 5]);
    await review(asciiFeedback, [4, 4, 4]);
    for (const bookingId of unicodeBookings) {
      assert.equal((await reviews.findMine(bookingId, reviewerId)).review?.feedback, feedback);
    }
    const stored = await prisma.$queryRaw<{ length: number }[]>`
      SELECT CHAR_LENGTH("feedback")::int AS "length" FROM "Review"
      WHERE "tutorProfileId" = ${thaiFeedback.tutorId}::uuid
    `;
    assert.deepEqual(stored, [{ length: 1000 }, { length: 1000 }]);
    const publicList = await reviews.listForTutor(thaiFeedback.tutorId, {});
    assert.deepEqual(
      publicList.items.map((item) => item.feedback),
      [feedback, feedback],
    );
    assert.deepEqual(await shown(thaiFeedback, unicode), everywhere(4.33, 2));
    assert.deepEqual(await shown(asciiFeedback, unicode), everywhere(4.33, 2));
    pass(
      '1000 code points of Thai, emoji and combining marks are stored and read back exactly; ' +
        'the rating is 4.33/2, the same as with ASCII feedback',
    );

    process.stdout.write(`Passed ${passed} rating regression database checks.\n`);
  } finally {
    try {
      await prisma.review.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.booking.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.availabilitySlot.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.teachingListing.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: tutors } } });
      await prisma.user.deleteMany({ where: { id: { in: [...tutors, reviewerId] } } });
      await prisma.subject.deleteMany({ where: { id: { in: subjects.map(({ id }) => id) } } });
      await prisma.gradeLevel.deleteMany({ where: { id: gradeId } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : 'Rating regression verification failed'}\n` +
        'Discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

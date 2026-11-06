import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';

import {
  AccountStatus,
  AttendanceStatus,
  BookingStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  readTutorReviewTotals,
  reconcileTutorReviewRatings,
  tutorReviewDisplayAverage,
} from '@modules/reviews/review-ratings';
import { ReviewsService } from '@modules/reviews/reviews.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorRankingPriority, TutorRecommendationTag } from '@modules/tutors/tutor-ranking';
import { MAX_TUTOR_SEARCH_PAGE_SIZE } from '@modules/tutors/tutors.dto';

import type { TutorSearchQueryDto, TutorSearchResultDto } from '@modules/tutors/tutors.dto';

/**
 * S3-T19: proves on real PostgreSQL that public search filters, ranks, tags and displays ratings
 * from Review rows (S3-T17 raw totals), not the rounded TutorProfile cache. Every fixture rating is
 * a set of completed, attended bookings with real reviews; no aggregate is seeded.
 */

type Scores = readonly [clarity: number, punctuality: number, preparation: number];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const { EARLIEST_AVAILABILITY, FITS_BUDGET, HIGHEST_RATED, LOWEST_PRICE } = TutorRecommendationTag;
const repeat = (scores: Scores, times: number): Scores[] =>
  Array.from({ length: times }, () => scores);

export function disposableSearchRatingDatabaseUrl(env: NodeJS.ProcessEnv): string {
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

interface TutorOptions {
  price: string;
  publishedDaysAgo?: number;
  reviews?: readonly Scores[];
  verificationStatus?: TutorVerificationStatus;
  accountStatus?: AccountStatus;
  userDeleted?: boolean;
  listingStatus?: ListingPublicationStatus;
  listingDeleted?: boolean;
}

interface Fixture {
  tutorId: string;
  listingId: string;
}

async function verify(): Promise<void> {
  const databaseUrl = disposableSearchRatingDatabaseUrl(process.env);
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
    const row = { id: randomUUID(), name: `s3-t19-${randomUUID()}` };
    await prisma.subject.create({ data: { ...row, code: row.id } });
    subjects.push(row);
    return row.name;
  }

  async function completedClass(tutor: Fixture): Promise<string> {
    const startAtUtc = new Date(now - 30 * DAY_MS - slotOffset++ * HOUR_MS * 2);
    const slot = await prisma.availabilitySlot.create({
      data: {
        tutorProfileId: tutor.tutorId,
        startAtUtc,
        endAtUtc: new Date(startAtUtc.getTime() + HOUR_MS),
      },
    });
    const booking = await prisma.booking.create({
      data: {
        studentUserId: reviewerId,
        tutorProfileId: tutor.tutorId,
        listingId: tutor.listingId,
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

  async function addReview(tutor: Fixture, [clarity, punctuality, preparation]: Scores) {
    await prisma.review.create({
      data: {
        bookingId: await completedClass(tutor),
        authorStudentUserId: reviewerId,
        tutorProfileId: tutor.tutorId,
        bookingStatus: BookingStatus.COMPLETED,
        clarity,
        punctuality,
        preparation,
        feedback: 'Synthetic review for S3-T19.',
      },
    });
  }

  async function tutor(subjectName: string, options: TutorOptions): Promise<Fixture> {
    const tutorId = randomUUID();
    const listingId = randomUUID();
    const subjectId = subjects.find(({ name }) => name === subjectName)?.id;
    assert.ok(subjectId);
    tutors.push(tutorId);
    await prisma.user.create({
      data: {
        id: tutorId,
        email: `${tutorId}@s3-t19.invalid`,
        role: Role.TUTOR,
        accountStatus: options.accountStatus ?? AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        deletedAt: options.userDeleted ? new Date() : null,
      },
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutorId,
        displayName: 'Synthetic tutor',
        bio: 'S3-T19 search rating fixture',
        experienceYears: 2,
        verificationStatus: options.verificationStatus ?? TutorVerificationStatus.VERIFIED,
      },
    });
    const status = options.listingStatus ?? ListingPublicationStatus.PUBLISHED;
    await prisma.teachingListing.create({
      data: {
        id: listingId,
        tutorProfileId: tutorId,
        subjectId,
        gradeLevelId: gradeId,
        pricePerHour: options.price,
        description: 'Synthetic S3-T19 listing.',
        publicationStatus: status,
        publishedAt:
          status === ListingPublicationStatus.PUBLISHED
            ? new Date(now - (options.publishedDaysAgo ?? 1) * DAY_MS)
            : null,
        deletedAt: options.listingDeleted ? new Date() : null,
      },
    });
    const fixture = { tutorId, listingId };
    for (const scores of options.reviews ?? []) {
      await addReview(fixture, scores);
    }
    return fixture;
  }

  async function search(subjectName: string, query: TutorSearchQueryDto = {}) {
    return directory.searchPublicTutors({
      pageSize: MAX_TUTOR_SEARCH_PAGE_SIZE,
      subject: subjectName,
      ...query,
    });
  }
  const ids = (items: TutorSearchResultDto[]): string[] => items.map((item) => item.listingId);
  const view = (items: TutorSearchResultDto[]) =>
    items.map(({ listingId, ratingAverage, recommendationTags, reviewCount }) => ({
      listingId,
      ratingAverage,
      recommendationTags,
      reviewCount,
    }));

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
    // Reconciliation in check 8 rebuilds every tutor's cache, so the database must hold no others.
    assert.equal(await prisma.tutorProfile.count(), 0, 'Use an empty disposable database');

    await prisma.gradeLevel.create({
      data: { id: gradeId, code: gradeId, name: `s3-t19-${gradeId}`, sortOrder: 1 },
    });
    await prisma.user.create({
      data: {
        id: reviewerId,
        email: `${reviewerId}@s3-t19.invalid`,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
      },
    });

    // Group A: exact thresholds, display, unreviewed and hidden tutors.
    const a = await subject();
    const thirteenThirds = await tutor(a, { price: '300.00', reviews: [[5, 4, 4]] });
    const fourExact = await tutor(a, { price: '310.00', reviews: [[4, 4, 4]] });
    const oneExact = await tutor(a, { price: '320.00', reviews: [[1, 1, 1]] });
    const unreviewed = await tutor(a, { price: '330.00' });
    const perfect: readonly Scores[] = [[5, 5, 5]];
    const hidden = [
      await tutor(a, {
        price: '100.00',
        reviews: perfect,
        verificationStatus: TutorVerificationStatus.UNVERIFIED,
      }),
      await tutor(a, {
        price: '100.00',
        reviews: perfect,
        accountStatus: AccountStatus.SUSPENDED,
      }),
      await tutor(a, {
        price: '100.00',
        reviews: perfect,
        accountStatus: AccountStatus.DELETED,
        userDeleted: true,
      }),
      await tutor(a, {
        price: '100.00',
        reviews: perfect,
        listingStatus: ListingPublicationStatus.DRAFT,
      }),
      await tutor(a, { price: '100.00', reviews: perfect, listingDeleted: true }),
    ].map(({ listingId }) => listingId);

    const minimum = async (minimumRating: number) =>
      ids((await search(a, { minimumRating })).items).sort();
    assert.deepEqual(await minimum(4.33), [thirteenThirds.listingId].sort());
    assert.deepEqual(await minimum(4.34), []);
    assert.deepEqual(await minimum(4), [thirteenThirds.listingId, fourExact.listingId].sort());
    assert.deepEqual(await minimum(4.01), [thirteenThirds.listingId]);
    assert.deepEqual(
      await minimum(1),
      [thirteenThirds.listingId, fourExact.listingId, oneExact.listingId].sort(),
    );
    assert.deepEqual(await minimum(5), []);
    pass('minimumRating is inclusive and exact: 13/3 passes 4.33, fails 4.34; 4.00 and 1.00 pass');

    const ranked = await search(a, { priority: TutorRankingPriority.HIGHEST_RATING });
    assert.deepEqual(view(ranked.items), [
      {
        listingId: thirteenThirds.listingId,
        ratingAverage: 4.33,
        recommendationTags: [HIGHEST_RATED],
        reviewCount: 1,
      },
      { listingId: fourExact.listingId, ratingAverage: 4, recommendationTags: [], reviewCount: 1 },
      { listingId: oneExact.listingId, ratingAverage: 1, recommendationTags: [], reviewCount: 1 },
      {
        listingId: unreviewed.listingId,
        ratingAverage: null,
        recommendationTags: [],
        reviewCount: 0,
      },
    ]);
    assert.equal(ranked.total, 4);
    for (const query of [
      {},
      { priority: TutorRankingPriority.LOWEST_PRICE },
      { minimumRating: 1 },
    ]) {
      const items = ids((await search(a, query)).items);
      assert.ok(
        items.every((id) => !hidden.includes(id)),
        'Hidden tutors must never appear',
      );
    }
    pass(
      'unreviewed tutors sort last as null/0; five hidden 5.00 tutors never appear or win the tag',
    );

    // Group B: rounding, exact ties, every priority, tags across pages.
    const b = await subject();
    const near62 = await tutor(b, {
      price: '200.00',
      publishedDaysAgo: 10,
      reviews: [...repeat([4, 4, 4], 4), [5, 5, 4]],
    }); // 62 / 15 = 4.1333...
    const near99 = await tutor(b, {
      price: '200.00',
      publishedDaysAgo: 20,
      reviews: [...repeat([4, 4, 4], 7), [5, 5, 5]],
    }); // 99 / 24 = 4.125
    const tieA = await tutor(b, { price: '250.00', publishedDaysAgo: 5, reviews: [[5, 4, 4]] });
    const tieB = await tutor(b, {
      price: '250.00',
      publishedDaysAgo: 15,
      reviews: [
        [5, 4, 4],
        [4, 5, 4],
      ],
    }); // 26 / 6 equals 13 / 3
    const best = await tutor(b, { price: '400.00', reviews: perfect });

    const nearPair = await search(b, {
      maxPrice: 200,
      priority: TutorRankingPriority.HIGHEST_RATING,
    });
    assert.deepEqual(view(nearPair.items), [
      {
        listingId: near62.listingId,
        ratingAverage: 4.13,
        recommendationTags: [FITS_BUDGET, HIGHEST_RATED],
        reviewCount: 5,
      },
      {
        listingId: near99.listingId,
        ratingAverage: 4.13,
        recommendationTags: [FITS_BUDGET],
        reviewCount: 8,
      },
    ]);
    assert.deepEqual(ids((await search(b, { minimumRating: 4.13, maxPrice: 200 })).items), [
      near62.listingId,
    ]);
    pass('4.1333 and 4.125 both display 4.13 but rank, tag and filter apart on raw values');

    const tied = await search(b, { maxPrice: 250, priority: TutorRankingPriority.HIGHEST_RATING });
    assert.deepEqual(
      tied.items.map(({ listingId, recommendationTags }) => [listingId, recommendationTags]),
      [
        [tieA.listingId, [FITS_BUDGET, HIGHEST_RATED]],
        [tieB.listingId, [FITS_BUDGET, HIGHEST_RATED]],
        [near62.listingId, [FITS_BUDGET]],
        [near99.listingId, [FITS_BUDGET]],
      ],
    );
    const pages = [];
    for (let page = 1; page <= 5; page += 1) {
      pages.push(
        await search(b, {
          maxPrice: 250,
          page,
          pageSize: 1,
          priority: TutorRankingPriority.HIGHEST_RATING,
        }),
      );
    }
    assert.deepEqual(
      pages.map(({ items }) => ids(items)),
      [[tieA.listingId], [tieB.listingId], [near62.listingId], [near99.listingId], []],
    );
    assert.ok(pages.every(({ total, totalPages }) => total === 4 && totalPages === 4));
    assert.deepEqual(pages[1]?.items[0]?.recommendationTags, [FITS_BUDGET, HIGHEST_RATED]);
    assert.deepEqual(pages[2]?.items[0]?.recommendationTags, [FITS_BUDGET]);
    pass(
      '13/3 and 26/6 tie exactly (publishedAt breaks it); pages of 1 keep order and full-set tags',
    );

    const cheapest = await search(b, { priority: TutorRankingPriority.LOWEST_PRICE });
    assert.deepEqual(
      cheapest.items.map(({ listingId, recommendationTags }) => [listingId, recommendationTags]),
      [
        [near62.listingId, [LOWEST_PRICE]],
        [near99.listingId, [LOWEST_PRICE]],
        [tieA.listingId, []],
        [tieB.listingId, []],
        [best.listingId, []],
      ],
    );
    assert.deepEqual(ids((await search(b, { minimumRating: 5 })).items), [best.listingId]);

    for (const [fixture, days] of [
      [near99, 1],
      [tieB, 2],
      [best, 3],
    ] as const) {
      const startAtUtc = new Date(now + days * DAY_MS);
      await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: fixture.tutorId,
          startAtUtc,
          endAtUtc: new Date(startAtUtc.getTime() + HOUR_MS),
        },
      });
    }
    const earliest = await search(b, { priority: TutorRankingPriority.EARLIEST_AVAILABILITY });
    assert.deepEqual(
      earliest.items.map(({ listingId, recommendationTags }) => [listingId, recommendationTags]),
      [
        [near99.listingId, [EARLIEST_AVAILABILITY]],
        [tieB.listingId, []],
        [best.listingId, []],
        [tieA.listingId, []],
        [near62.listingId, []],
      ],
    );
    pass(
      'lowest_price breaks a price tie by raw rating; earliest_availability and 5.00 inclusive hold',
    );

    // Group C: a stale cache, concurrent real review creation and S3-T17 totals.
    const c = await subject();
    const stale = await tutor(c, {
      price: '300.00',
      reviews: [
        [5, 5, 5],
        [3, 3, 3],
      ],
    }); // 24 / 6 = 4.00
    await prisma.tutorProfile.update({
      where: { userId: stale.tutorId },
      data: { ratingAverage: '1.00', reviewCount: 77, ratingUpdatedAt: new Date() },
    });
    const staleView = view((await search(c, { minimumRating: 4 })).items);
    assert.deepEqual(staleView, [
      { listingId: stale.listingId, ratingAverage: 4, recommendationTags: [], reviewCount: 2 },
    ]);
    await reconcileTutorReviewRatings(prisma);
    const rebuilt = await prisma.tutorProfile.findUniqueOrThrow({
      where: { userId: stale.tutorId },
    });
    assert.equal(rebuilt.ratingAverage?.toFixed(2), '4.00');
    assert.equal(rebuilt.reviewCount, 2);
    pass(
      'a stale 1.00/77 cache never drives search; S3-T17 reconciliation then rebuilds it to 4.00/2',
    );

    const busy = await tutor(c, { price: '310.00' });
    const busyScores: Scores[] = [
      [5, 5, 5],
      [4, 4, 4],
      [3, 4, 5],
      [5, 4, 4],
      [2, 3, 4],
      [5, 5, 4],
    ];
    const bookings: string[] = [];
    for (let index = 0; index < busyScores.length; index += 1) {
      bookings.push(await completedClass(busy));
    }
    const created = await Promise.allSettled(
      busyScores.map(([clarity, punctuality, preparation], index) =>
        reviews.create(bookings[index] ?? '', reviewerId, {
          clarity,
          feedback: 'Concurrent synthetic review for S3-T19.',
          preparation,
          punctuality,
        }),
      ),
    );
    assert.ok(
      created.every(({ status }) => status === 'fulfilled'),
      'Every review must be created',
    );
    const busyItem = (await search(c)).items.find(({ listingId }) => listingId === busy.listingId);
    // 15 + 12 + 12 + 13 + 9 + 14 = 75 over 18 dimensions: 4.1666... displays 4.17.
    assert.deepEqual(busyItem && [busyItem.ratingAverage, busyItem.reviewCount], [4.17, 6]);
    const detail = await directory.getPublicTutor(busy.tutorId);
    assert.deepEqual([detail.tutor.ratingAverage, detail.tutor.reviewCount], [4.17, 6]);
    pass(
      'six concurrent ReviewsService reviews: search and the S3-T17 detail cache both show 4.17/6',
    );

    for (const name of [a, b, c]) {
      for (const item of (await search(name)).items) {
        const totals = await prisma.$transaction((tx) => readTutorReviewTotals(tx, item.tutorId));
        assert.equal(item.reviewCount, totals.reviewCount);
        assert.equal(item.ratingAverage, tutorReviewDisplayAverage(totals)?.toNumber() ?? null);
      }
    }
    pass('every search result matches S3-T17 readTutorReviewTotals and its HALF_UP display rule');

    process.stdout.write(`Passed ${passed} search rating database checks.\n`);
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
      `${error instanceof Error ? (error.stack ?? error.message) : 'Search rating verification failed'}\n` +
        'Discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

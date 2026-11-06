import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  readTutorReviewTotals,
  reconcileTutorReviewRatings,
} from '@modules/reviews/review-ratings';
import { ReviewsService } from '@modules/reviews/reviews.service';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorsPublicController } from '@modules/tutors/tutors-public.controller';

import type { INestApplication } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { App } from 'supertest/types';

export function disposableReviewRatingDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  assert.equal(
    environment['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Disposable opt-in required',
  );
  const value = environment['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required; this verifier never loads .env');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Loopback required');
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[_-].*[_-]test$/);
  assert.equal(url.search, '', 'URL options are refused');
  assert.equal(url.hash, '', 'URL fragments are refused');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pass(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function verify(): Promise<void> {
  const databaseUrl = disposableReviewRatingDatabaseUrl(process.env);
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const pool = new Pool({ connectionString: databaseUrl, max: 2, statement_timeout: 10_000 });
  const studentId = randomUUID();
  const tutorId = randomUUID();
  const emptyTutorId = randomUUID();
  // Cross the reconciliation batch boundary without borrowing any pre-existing records.
  const tutorIds = [tutorId, emptyTutorId, ...Array.from({ length: 101 }, () => randomUUID())];
  const userIds = [studentId, ...tutorIds];
  const subjectId = randomUUID();
  const gradeId = randomUUID();
  const listingId = randomUUID();
  const probe = `review_rating_probe_${randomUUID().replaceAll('-', '')}`;
  const moduleRef = await Test.createTestingModule({
    controllers: [TutorsPublicController],
    providers: [
      ReviewsService,
      TutorDirectoryService,
      { provide: TutorAvailabilityService, useValue: {} },
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  const app: INestApplication<App> = moduleRef.createNestApplication();
  configureApplication(app);
  const reviews = moduleRef.get(ReviewsService);
  const directory = moduleRef.get(TutorDirectoryService);
  let bookingsCreated = 0;

  async function booking(): Promise<string> {
    const start = new Date(Date.UTC(2099, 0, 2 + bookingsCreated++, 10));
    const slot = await prisma.availabilitySlot.create({
      data: { tutorProfileId: tutorId, startAtUtc: start, endAtUtc: new Date(+start + 3_600_000) },
    });
    const saved = await prisma.booking.create({
      data: {
        studentUserId: studentId,
        tutorProfileId: tutorId,
        listingId,
        slotId: slot.id,
        status: 'COMPLETED',
        subtotalAmount: '450.00',
        netAmount: '450.00',
      },
    });
    return saved.id;
  }

  async function assertDetail(owner: string, average: number | null, count: number): Promise<void> {
    const response = await request(app.getHttpServer()).get(`/api/v1/tutors/${owner}`).expect(200);
    const body: unknown = response.body;
    assert.ok(isRecord(body) && isRecord(body['tutor']));
    assert.deepEqual(Object.keys(body).sort(), ['listings', 'tutor']);
    const tutor = body['tutor'];
    assert.deepEqual(tutor, {
      avatarUpdatedAt: null,
      bio: 'Synthetic rating verification',
      displayName: 'Synthetic tutor',
      experienceYears: 1,
      ratingAverage: average,
      reviewCount: count,
      tutorId: owner,
      verificationStatus: 'VERIFIED',
    });
    const search = await directory.searchPublicTutors({});
    if (owner === tutorId) {
      const item = search.items.find((row) => row.tutorId === owner);
      assert.ok(item);
      assert.equal(item.ratingAverage, average);
      assert.equal(item.reviewCount, count);
    }
  }

  async function waitForTutorWaiters(count: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (true) {
      const result = await pool.query<{ count: number }>(`
        SELECT COUNT(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%TutorProfile%FOR UPDATE%'
      `);
      if ((result.rows[0]?.count ?? 0) >= count) {
        return;
      }
      assert.ok(Date.now() < deadline, 'Expected real tutor-row lock contention');
      await new Promise((done) => setTimeout(done, 10));
    }
  }

  async function contend(operations: (() => Promise<unknown>)[]): Promise<void> {
    const gate: PoolClient = await pool.connect();
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT "userId" FROM "TutorProfile" WHERE "userId" = $1 FOR UPDATE', [
        tutorId,
      ]);
      pending = Promise.allSettled(operations.map((operation) => operation()));
      await waitForTutorWaiters(operations.length);
      await gate.query('COMMIT');
      for (const outcome of await pending) {
        if (outcome.status === 'rejected') {
          throw outcome.reason;
        }
      }
    } finally {
      await gate.query('ROLLBACK');
      await pending;
      gate.release();
    }
  }

  async function removeProbe(): Promise<void> {
    await pool.query(`DROP TRIGGER IF EXISTS "${probe}" ON "TutorProfile"`);
    await pool.query(`DROP FUNCTION IF EXISTS "${probe}"()`);
  }

  try {
    await prisma.$connect();
    const target = await prisma.$queryRaw<{ database: string; schema: string }[]>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [
      {
        database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)),
        schema: 'public',
      },
    ]);
    const migrations = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    assert.ok(migrations.every((name) => applied.some((row) => row.migration_name === name)));
    assert.equal(await prisma.user.count(), 0, 'Use a new empty disposable database');
    await prisma.user.create({
      data: { id: studentId, email: `${studentId}@rating.invalid`, role: 'STUDENT' },
    });
    await prisma.user.createMany({
      data: tutorIds.map((id) => ({
        id,
        email: `${id}@rating.invalid`,
        role: 'TUTOR' as const,
      })),
    });
    await prisma.tutorProfile.createMany({
      data: tutorIds.map((id) => ({
        userId: id,
        displayName: 'Synthetic tutor',
        bio: 'Synthetic rating verification',
        experienceYears: 1,
        verificationStatus: 'VERIFIED' as const,
      })),
    });
    await prisma.subject.create({ data: { id: subjectId, code: subjectId, name: subjectId } });
    await prisma.gradeLevel.create({
      data: { id: gradeId, code: gradeId, name: gradeId, sortOrder: 1 },
    });
    await prisma.teachingListing.create({
      data: {
        id: listingId,
        tutorProfileId: tutorId,
        subjectId,
        gradeLevelId: gradeId,
        pricePerHour: '450.00',
        description: 'Synthetic lesson for rating verification',
        publicationStatus: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    await app.init();
    await assertDetail(tutorId, null, 0);
    await assertDetail(emptyTutorId, null, 0);

    const first = await booking();
    const second = await booking();
    await contend([
      () =>
        reviews.create(first, studentId, {
          clarity: 5,
          punctuality: 4,
          preparation: 5,
          feedback: 'First',
        }),
      () =>
        reviews.create(second, studentId, {
          clarity: 4,
          punctuality: 4,
          preparation: 4,
          feedback: 'Second',
        }),
    ]);
    await assertDetail(tutorId, 4.33, 2);
    const totals = await prisma.$transaction((tx) => readTutorReviewTotals(tx, tutorId));
    assert.equal(totals.dimensionTotal.toString(), '26');
    assert.equal(totals.reviewCount, 2);
    pass(
      'PASS: real concurrent review creation, raw totals, HALF_UP display, detail/search freshness',
    );

    const savedReviews = await prisma.review.findMany({ orderBy: { id: 'asc' } });
    const savedBookings = await prisma.booking.findMany({ orderBy: { id: 'asc' } });
    await prisma.tutorProfile.updateMany({
      data: {
        ratingAverage: '1.00',
        reviewCount: 77,
        ratingUpdatedAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    });
    assert.equal(await reconcileTutorReviewRatings(prisma), tutorIds.length);
    await assertDetail(tutorId, 4.33, 2);
    await assertDetail(emptyTutorId, null, 0);
    assert.equal(
      await prisma.tutorProfile.count({
        where: { reviewCount: 0, ratingAverage: null, ratingUpdatedAt: null },
      }),
      102,
    );
    assert.deepEqual(await prisma.review.findMany({ orderBy: { id: 'asc' } }), savedReviews);
    assert.deepEqual(await prisma.booking.findMany({ orderBy: { id: 'asc' } }), savedBookings);
    const latest = await prisma.tutorProfile.findUniqueOrThrow({ where: { userId: tutorId } });
    assert.deepEqual(latest.ratingUpdatedAt, totals.latestReviewAt);
    await reconcileTutorReviewRatings(prisma);
    await assertDetail(tutorId, 4.33, 2);
    pass(
      'PASS: stale/no-review cache repair across 103 tutors, rerun, timestamp, preserved review/booking history',
    );

    const third = await booking();
    await contend([
      () => reconcileTutorReviewRatings(prisma),
      () =>
        reviews.create(third, studentId, {
          clarity: 5,
          punctuality: 5,
          preparation: 5,
          feedback: 'Third',
        }),
    ]);
    await assertDetail(tutorId, 4.56, 3);
    pass('PASS: reconciliation serializes with live review creation without losing count');

    await pool.query(`CREATE FUNCTION "${probe}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."userId" = '${tutorId}'::uuid THEN
        RAISE EXCEPTION 'Synthetic cache update failure';
      END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER "${probe}" BEFORE UPDATE ON "TutorProfile"
      FOR EACH ROW EXECUTE FUNCTION "${probe}"()`);
    const failedBooking = await booking();
    await assert.rejects(() =>
      reviews.create(failedBooking, studentId, {
        clarity: 1,
        punctuality: 1,
        preparation: 1,
        feedback: 'Must roll back',
      }),
    );
    assert.equal(await prisma.review.findUnique({ where: { bookingId: failedBooking } }), null);
    await assertDetail(tutorId, 4.56, 3);
    await assert.rejects(() => reconcileTutorReviewRatings(prisma));
    await removeProbe();
    await reconcileTutorReviewRatings(prisma);
    await assertDetail(tutorId, 4.56, 3);
    pass(
      'PASS: failed cache update rolls back the new review; failed reconciliation is restartable',
    );

    await request(app.getHttpServer()).get(`/api/v1/tutors/${tutorId}?unknown=value`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/tutors/not-a-uuid').expect(400);
    await request(app.getHttpServer()).get(`/api/v1/tutors/${randomUUID()}`).expect(404);
    await prisma.tutorProfile.update({
      where: { userId: tutorId },
      data: { verificationStatus: 'UNVERIFIED' },
    });
    await request(app.getHttpServer()).get(`/api/v1/tutors/${tutorId}`).expect(404);
    pass(
      'PASS: detail wrapper/numeric wire types, unknown query/UUID 400, missing/hidden tutor 404, public projection',
    );
  } finally {
    try {
      await removeProbe();
      await prisma.review.deleteMany({ where: { tutorProfileId: { in: tutorIds } } });
      await prisma.booking.deleteMany({ where: { tutorProfileId: { in: tutorIds } } });
      await prisma.availabilitySlot.deleteMany({ where: { tutorProfileId: { in: tutorIds } } });
      await prisma.teachingListing.deleteMany({ where: { id: listingId } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: tutorIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.subject.deleteMany({ where: { id: subjectId } });
      await prisma.gradeLevel.deleteMany({ where: { id: gradeId } });
    } finally {
      await app.close();
      await prisma.$disconnect();
      await pool.end();
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      new Logger('ReviewRatingsVerification').error(`Database operation failed: ${error.code}`);
    } else if (error instanceof assert.AssertionError) {
      new Logger('ReviewRatingsVerification').error(error.message);
    } else if (error instanceof Error) {
      new Logger('ReviewRatingsVerification').error(error.name);
    }
    new Logger('ReviewRatingsVerification').error(
      'Review rating verification failed; discard the disposable database',
    );
    process.exitCode = 1;
  });
}

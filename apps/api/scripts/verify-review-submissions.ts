import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { Pool } from 'pg';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import { Prisma } from '@generated/prisma/client';
import { BookingStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  ReviewController,
  ReviewsController,
  TutorReviewsController,
} from '@modules/reviews/reviews.controller';
import { ReviewsService } from '@modules/reviews/reviews.service';

import type { INestApplication } from '@nestjs/common';
import type { Test as HttpTest } from 'supertest';
import type { App } from 'supertest/types';

const DATABASE_NAME = 'hktutor_s3_t15_test';
const AT = new Date('2026-01-01T08:00:00.000Z');
const FEEDBACK = '😀'.repeat(1000);
const FIRST_REVIEW = {
  clarity: 4,
  punctuality: 4,
  preparation: 4,
  feedback: '<b>Synthetic review</b>',
};
const RACED_REVIEW = { clarity: 5, punctuality: 4, preparation: 5, feedback: FEEDBACK };
const UNFINISHED = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.CANCELED,
  BookingStatus.EXPIRED,
];

function disposableDatabaseUrl(): string {
  assert.equal(
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable opt-in required',
  );
  const value = process.env['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required; this verifier never loads .env');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid disposable database URL');
  }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Loopback required');
  assert.equal(url.pathname, '/' + DATABASE_NAME, 'Dedicated S3-T15 test database required');
  assert.ok(!url.search && !url.hash, 'URL options and fragments are refused');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function expectError(
  operation: HttpTest,
  status: number,
  code: string,
  label: string,
): Promise<void> {
  const response = await operation;
  const body: unknown = response.body;
  assert.equal(response.status, status, label + ': status');
  assert.ok(isRecord(body) && body['code'] === code, label + ': error code');
}

async function verify(): Promise<void> {
  const databaseUrl = disposableDatabaseUrl();
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_ACCESS_TTL_SECONDS: '900',
    JWT_AUDIENCE: 's3-t15-qa',
    JWT_ISSUER: 's3-t15-qa',
  });
  const auth = new AuthConfigService(config);
  const tokens = new JwtTokenService(auth);
  const prisma = new PrismaService(config);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  let app: INestApplication<App> | undefined;

  async function user(role: Role) {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        role,
        email: id + '@reviews.invalid',
        emailVerifiedAt: AT,
        consentAcceptedAt: AT,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: id,
        expiresAt: new Date(Date.now() + 900_000),
        refreshTokenHash: randomBytes(32).toString('hex'),
      },
    });
    return { id, sessionId: session.id, accessToken: tokens.signAccessToken(id, session.id, role) };
  }

  try {
    const target = await prisma.$queryRaw<{ database: string; schema: string }[]>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(
      target,
      [{ database: DATABASE_NAME, schema: 'public' }],
      'Unexpected database or schema',
    );
    const migrations = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    assert.ok(
      migrations.every((name) => applied.some((row) => row.migration_name === name)),
      'Apply all migrations first',
    );
    assert.equal(await prisma.user.count(), 0, 'Use a new empty disposable database');

    const module = await Test.createTestingModule({
      controllers: [ReviewController, ReviewsController, TutorReviewsController],
      providers: [
        ReviewsService,
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        { provide: JwtTokenService, useValue: tokens },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>({ logger: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const http = request(app.getHttpServer());
    const student = await user(Role.STUDENT);
    const other = await user(Role.STUDENT);
    const tutor = await user(Role.TUTOR);
    const admin = await user(Role.ADMIN);
    await prisma.studentProfile.create({
      data: {
        userId: student.id,
        firstName: 'Private',
        lastName: 'Fixture',
        nickname: 'QA learner',
        school: 'Synthetic school',
        gradeLevel: 'QA',
        phone: '0000000000',
      },
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutor.id,
        displayName: 'QA tutor',
        bio: 'Synthetic fixture',
        experienceYears: 1,
        verificationStatus: 'VERIFIED',
      },
    });
    const subject = await prisma.subject.create({
      data: { code: 'QA', name: 'Synthetic subject' },
    });
    const grade = await prisma.gradeLevel.create({
      data: { code: 'QA', name: 'Synthetic grade', sortOrder: 1 },
    });
    const listing = await prisma.teachingListing.create({
      data: {
        tutorProfileId: tutor.id,
        subjectId: subject.id,
        gradeLevelId: grade.id,
        pricePerHour: '450.00',
        description: 'Synthetic lesson for review verification',
        publicationStatus: 'PUBLISHED',
        publishedAt: AT,
      },
    });
    let slotNumber = 0;
    async function booking(status: BookingStatus): Promise<string> {
      const startAtUtc = new Date(AT.getTime() + slotNumber++ * 86_400_000);
      const slot = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: tutor.id,
          startAtUtc,
          endAtUtc: new Date(startAtUtc.getTime() + 3_600_000),
        },
      });
      const saved = await prisma.booking.create({
        data: {
          studentUserId: student.id,
          tutorProfileId: tutor.id,
          listingId: listing.id,
          slotId: slot.id,
          status,
          subtotalAmount: '450.00',
          netAmount: '450.00',
          ...(status === BookingStatus.CANCELED
            ? {
                canceledAt: AT,
                canceledById: student.id,
                cancellationReason: 'Synthetic cancellation',
              }
            : {}),
        },
      });
      return saved.id;
    }

    const original = await booking(BookingStatus.COMPLETED);
    const raced = await booking(BookingStatus.COMPLETED);
    const postPath = (id: string) => '/api/v1/bookings/me/' + id + '/reviews';
    const privatePath = '/api/v1/bookings/me/' + raced + '/review';
    const publicPath = '/api/v1/tutors/' + tutor.id + '/reviews';
    const bearer = { type: 'bearer' } as const;
    const post = (id: string, token = student.accessToken) =>
      http.post(postPath(id)).auth(token, bearer).send(RACED_REVIEW).timeout({ deadline: 12_000 });
    const expired = sign(
      { jti: randomUUID(), sid: student.sessionId, role: Role.STUDENT, type: 'access' },
      auth.accessSecret,
      { subject: student.id, issuer: auth.issuer, audience: auth.audience, expiresIn: -60 },
    );

    await http.get(privatePath).auth(student.accessToken, bearer).expect(200, { review: null });
    await expectError(
      http.get(privatePath).auth(other.accessToken, bearer),
      403,
      'BOOKING_NOT_OWNED',
      'foreign read',
    );
    await expectError(
      http.post(postPath(raced)).send(RACED_REVIEW),
      401,
      'UNAUTHENTICATED',
      'missing token',
    );
    await expectError(post(raced, expired), 401, 'UNAUTHENTICATED', 'expired token');
    await expectError(post(raced, other.accessToken), 403, 'BOOKING_NOT_OWNED', 'wrong student');
    await expectError(post(raced, tutor.accessToken), 403, 'FORBIDDEN', 'tutor');
    await expectError(post(raced, admin.accessToken), 403, 'FORBIDDEN', 'admin');
    await expectError(post(randomUUID()), 404, 'BOOKING_NOT_FOUND', 'missing booking');
    await expectError(post('not-a-uuid'), 400, 'INVALID_UUID', 'invalid booking UUID');
    for (const status of UNFINISHED) {
      await expectError(post(await booking(status)), 409, 'BOOKING_NOT_COMPLETED', status);
    }
    assert.equal(await prisma.review.count(), 0, 'Denied requests must not write reviews');
    process.stdout.write(
      'PASS private null/foreign read, missing/expired JWT, roles, booking ID and all four unfinished states; Review rows=0\n',
    );

    await http
      .post(postPath(original))
      .auth(student.accessToken, bearer)
      .send(FIRST_REVIEW)
      .expect(201);
    async function snapshot() {
      const profile = await prisma.tutorProfile.findUniqueOrThrow({ where: { userId: tutor.id } });
      return {
        bookingReviewRows: await prisma.review.count({ where: { bookingId: raced } }),
        tutorReviewRows: await prisma.review.count({ where: { tutorProfileId: tutor.id } }),
        reviewCount: profile.reviewCount,
        ratingAverage: profile.ratingAverage?.toFixed(2) ?? null,
      };
    }
    const before = await snapshot();
    assert.deepEqual(before, {
      bookingReviewRows: 0,
      tutorReviewRows: 1,
      reviewCount: 1,
      ratingAverage: '4.00',
    });

    // The gate holds the target row until PostgreSQL observes both real POST transactions waiting.
    const gate = await pool.connect();
    let submissions: Promise<PromiseSettledResult<Awaited<HttpTest>>[]> | undefined;
    try {
      await gate.query('BEGIN');
      await gate.query('SELECT id FROM "Booking" WHERE id = $1::uuid FOR UPDATE', [raced]);
      submissions = Promise.allSettled([post(raced), post(raced)]);
      const deadline = Date.now() + 3_000;
      while (true) {
        const waiting = await pool.query<{ count: number }>(`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%"Booking"%FOR UPDATE%'
        `);
        if (waiting.rows[0]?.count === 2) {
          break;
        }
        assert.ok(Date.now() < deadline, 'Both POSTs must wait on the booking lock');
        await setTimeout(20);
      }
    } finally {
      try {
        await gate.query('ROLLBACK');
      } finally {
        gate.release();
        await submissions;
      }
    }
    assert.ok(submissions);
    const responses = (await submissions).map((result) => {
      assert.ok(result.status === 'fulfilled', 'A concurrent HTTP request failed');
      return result.value;
    });
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409],
      'Concurrent POST status pair',
    );
    const winner = responses.find((response) => response.status === 201);
    const conflict: unknown = responses.find((response) => response.status === 409)?.body;
    assert.ok(
      winner && isRecord(conflict) && conflict['code'] === 'REVIEW_ALREADY_EXISTS',
      'Expected duplicate conflict',
    );
    const after = await snapshot();
    assert.deepEqual(after, {
      bookingReviewRows: 1,
      tutorReviewRows: 2,
      reviewCount: 2,
      ratingAverage: '4.33',
    });
    const readBack = await http.get(privatePath).auth(student.accessToken, bearer).expect(200);
    assert.deepEqual(readBack.body, winner.body, 'Private read must return the winner');
    process.stdout.write('PASS both POSTs blocked in PostgreSQL; 201/409 REVIEW_ALREADY_EXISTS\n');
    process.stdout.write(
      'Before: ' + JSON.stringify(before) + '\nAfter: ' + JSON.stringify(after) + '\n',
    );

    // Deliberately tie the two synthetic timestamps to exercise the secondary cursor key.
    const saved = await prisma.review.findUniqueOrThrow({ where: { bookingId: raced } });
    assert.equal(saved.feedback, FEEDBACK, 'Persist exactly 1000 astral code points');
    const earlier = await prisma.review.update({
      where: { bookingId: original },
      data: { createdAt: saved.createdAt },
    });
    const timestamp = saved.createdAt.toISOString();
    const expected = [
      { ...FIRST_REVIEW, id: earlier.id, overallRating: 4 },
      { ...RACED_REVIEW, id: saved.id, overallRating: 4.67 },
    ]
      .sort((a, b) => b.id.localeCompare(a.id))
      .map((review) => ({
        ...review,
        createdAt: timestamp,
        author: { displayName: 'QA learner' },
      }));
    const firstPage: unknown = (await http.get(publicPath).query({ limit: 1 }).expect(200)).body;
    assert.ok(
      isRecord(firstPage) && typeof firstPage['nextCursor'] === 'string',
      'First page must have a cursor',
    );
    assert.deepEqual(
      firstPage,
      { items: expected.slice(0, 1), nextCursor: firstPage['nextCursor'] },
      'First public page shape and order',
    );
    await http
      .get(publicPath)
      .query({ limit: 1, cursor: firstPage['nextCursor'] })
      .expect(200, { items: expected.slice(1), nextCursor: null });
    await prisma.tutorProfile.update({
      where: { userId: tutor.id },
      data: { verificationStatus: 'UNVERIFIED' },
    });
    await http.get(publicPath).expect(404);
    await prisma.tutorProfile.update({
      where: { userId: tutor.id },
      data: { verificationStatus: 'VERIFIED' },
    });
    await prisma.user.update({ where: { id: tutor.id }, data: { accountStatus: 'SUSPENDED' } });
    await http.get(publicPath).expect(404);
    process.stdout.write(
      'PASS public tie pagination across two pages, exact redacted shape, and unverified/suspended exclusion\n',
    );
  } finally {
    try {
      await app?.close();
    } finally {
      await Promise.all([prisma.$disconnect(), pool.end()]);
    }
  }
}

void verify().catch((error: unknown) => {
  const message =
    error instanceof assert.AssertionError && !error.generatedMessage
      ? error.message
      : error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : error instanceof Error
          ? error.name
          : 'Unknown failure';
  process.stderr.write('S3-T15 disposable verification failed: ' + message + '\n');
  process.exitCode = 1;
});

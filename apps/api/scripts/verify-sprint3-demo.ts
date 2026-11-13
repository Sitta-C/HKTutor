import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import 'reflect-metadata';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { disposableDatabaseUrl } from '@config/disposable-database-url';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { runSeed } from '@infrastructure/database/seed';
import { SEEDED_MATHEMATICS_GRADE10_LISTING_ID } from '@infrastructure/database/seed/booking-fixtures.seed';
import { SPRINT2_DEMO_IDS } from '@infrastructure/database/seed/sprint2-demo.seed';
import { SPRINT3_DEMO_IDS } from '@infrastructure/database/seed/sprint3-demo.seed';
import { EmailService } from '@infrastructure/email/email.service';
import { STORAGE_CLIENT } from '@infrastructure/storage/storage.types';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';

import type { INestApplication, Type } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * S3-T40 clean-environment rehearsal: on a fresh, migrated database the real seed runs twice, then
 * the three operational SEED_* accounts sign in through the real AppModule and perform every
 * Sprint 3 step of the demo runbook over HTTP. No payment provider is configured: the payment step
 * uses an admin-created 100% coupon, which settles zero net without Omise.
 */
const DATABASE_NAME = 'hktutor_s3_t40_test';
const DAY_MS = 24 * 3_600_000;

export function disposableDemoDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return disposableDatabaseUrl(env, DATABASE_NAME);
}

/** Synthetic, per-run values only; the demo accounts' passwords are never printed. */
export function demoRehearsalEnvironment(databaseUrl: string): Record<string, string> {
  const password = `Demo-${randomBytes(12).toString('hex')}-1a`;
  return {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: `s3-t40-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `s3-t40-refresh-${randomUUID()}`,
    RESEND_API_KEY: 're_s3_t40_test_only',
    EMAIL_FROM: 'HKTutor <no-reply@hktutor.test>',
    APP_URL: 'http://localhost:3000',
    WEB_ORIGIN: 'http://localhost:3000',
    COOKIE_SECURE: 'false',
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_s3_t40_test_only',
    SUPABASE_AVATAR_BUCKET: 's3-t40-avatars',
    SUPABASE_DOCUMENT_BUCKET: 's3-t40-documents',
    OMISE_SECRET_KEY: '',
    OMISE_WEBHOOK_SECRET: '',
    SEED_ADMIN_EMAIL: 'admin@s3-t40.hktutor.invalid',
    SEED_ADMIN_PASSWORD: password,
    SEED_TUTOR_EMAIL: 'tutor@s3-t40.hktutor.invalid',
    SEED_TUTOR_PASSWORD: password,
    SEED_STUDENT_EMAIL: 'student@s3-t40.hktutor.invalid',
    SEED_STUDENT_PASSWORD: password,
  };
}

async function verify(): Promise<void> {
  const databaseUrl = disposableDemoDatabaseUrl(process.env);
  const previousEnvironment = { ...process.env };
  const env = demoRehearsalEnvironment(databaseUrl);
  Object.assign(process.env, env);
  const { AppModule } = module.require('@app/app.module') as { AppModule: Type<unknown> };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('No outbound request is allowed in S3-T40'));

  let app: INestApplication<App> | undefined;
  let prisma: PrismaService | undefined;
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [seed + AppModule over HTTP + PostgreSQL] ${label}\n`);
  };

  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
      })
      .overrideProvider(STORAGE_CLIENT)
      .useValue({
        storage: {
          getBucket: () => Promise.resolve({ data: { public: false }, error: null }),
          from: () => ({
            upload: () => Promise.reject(new Error('Storage is not used by S3-T40')),
            remove: () => Promise.resolve({ data: [], error: null }),
            createSignedUrl: () => Promise.reject(new Error('Storage is not used by S3-T40')),
            getPublicUrl: (path: string) => ({
              data: { publicUrl: `https://storage.example.test/${path}` },
            }),
          }),
        },
      })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: ['error'] });
    app.use(cookieParser());
    configureApplication(app);
    await app.init();
    const server = app.getHttpServer();
    const db = moduleRef.get(PrismaService);
    prisma = db;

    // 1. Clean environment: exact target, every migration applied, nothing seeded yet.
    assert.deepEqual(
      await db.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`,
      [{ database: DATABASE_NAME }],
    );
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    assert.deepEqual(
      committed.filter((name) => !applied.some((row) => row.migration_name === name)),
      [],
      'Apply all migrations first',
    );
    assert.equal(await db.user.count(), 0, 'Use a new empty disposable database');
    const health = await request(server).get('/api/v1/health');
    assert.equal(health.status, 200);
    assert.equal((health.body as { database?: string }).database, 'connected');
    pass(`${committed.length} committed migrations applied to an empty database; health connected`);

    // 2. Seed twice: the second run must not change any demo row.
    const now = new Date();
    await runSeed(db, now);
    const digest = async (): Promise<string> => {
      const rows = await db.$queryRaw<{ snapshot: unknown }[]>`
        SELECT jsonb_build_object(
          'bookings', (SELECT jsonb_agg(to_jsonb(b) - 'updatedAt' ORDER BY id) FROM "Booking" b),
          'slots', (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM "AvailabilitySlot" s),
          'reviews', (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM "Review" r),
          'coupons', (SELECT jsonb_agg(to_jsonb(c) - 'updatedAt' ORDER BY id) FROM "Coupon" c)
        ) AS snapshot`;
      return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    };
    // The Sprint 2 ended-class reset rewrites its own row on every run, which only moves
    // updatedAt; every business column must stay identical.
    const first = await digest();
    await runSeed(db, now);
    assert.equal(await digest(), first, 'a repeated seed changes nothing');
    const reviewReady = await db.booking.findUniqueOrThrow({
      where: { id: SPRINT3_DEMO_IDS.reviewReadyBooking },
      select: {
        status: true,
        paymentStatus: true,
        attendance: true,
        review: { select: { id: true } },
      },
    });
    assert.deepEqual(reviewReady, {
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      attendance: 'ATTENDED',
      review: null,
    });
    pass(
      'runSeed twice is idempotent; the S3-T40 review-ready class is completed, paid and unreviewed',
    );

    // 3. The three operational accounts sign in with their SEED_* credentials.
    const http = (token?: string) => ({
      get: (path: string, query?: Record<string, string>) => {
        const pending = request(server)
          .get(`/api/v1${path}`)
          .query(query ?? {});
        return token ? pending.set('Authorization', `Bearer ${token}`) : pending;
      },
      post: (path: string, body?: object) => {
        const base = request(server).post(`/api/v1${path}`);
        const pending = token ? base.set('Authorization', `Bearer ${token}`) : base;
        return body === undefined ? pending : pending.send(body);
      },
      put: (path: string, body: object) => {
        const base = request(server).put(`/api/v1${path}`);
        return (token ? base.set('Authorization', `Bearer ${token}`) : base).send(body);
      },
    });
    function ok(response: request.Response, status: number, label: string): void {
      assert.equal(
        response.status,
        status,
        `${label}: expected ${status}, got ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    async function login(email: string, password: string): Promise<{ token: string; id: string }> {
      const response = await http().post('/auth/login', { email, password });
      ok(response, 200, `${email} login`);
      const body = response.body as { accessToken: string; user: { id: string } };
      return { token: body.accessToken, id: body.user.id };
    }
    const password = env['SEED_STUDENT_PASSWORD'] ?? '';
    const admin = await login(env['SEED_ADMIN_EMAIL'] ?? '', password);
    const tutor = await login(env['SEED_TUTOR_EMAIL'] ?? '', password);
    const student = await login(env['SEED_STUDENT_EMAIL'] ?? '', password);
    // As in the runbook, the seeded student and tutor accept the current notice on first sign-in.
    for (const actor of [tutor, student]) {
      ok(
        await http(actor.token).post('/auth/consent', {
          consent: true,
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        }),
        200,
        'accept the current privacy notice',
      );
    }
    pass(
      'seeded admin, tutor (Anan) and student (Nan) sign in; tutor and student accept the current notice',
    );

    // 4. Admin promotion (US9-1).
    const demoCode = 'DEMOFREE';
    const created = await http(admin.token).post('/admin/coupons', {
      code: demoCode.toLowerCase(),
      percent: 100,
      maxUses: 3,
      expiresAt: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
    });
    ok(created, 201, 'admin creates the demo coupon');
    const coupons = await http(admin.token).get('/admin/coupons');
    ok(coupons, 200, 'admin coupon list');
    const codes = (coupons.body as { items: { code: string }[] }).items.map((item) => item.code);
    assert.ok(codes.includes(demoCode) && codes.includes('WELCOME10'));
    pass('admin creates DEMOFREE (100%, 3 uses); WELCOME10 from the seed is listed');

    // 5. Discovery and comparison data (US10-1/2, US8-2).
    const mathematics = await http().get('/tutors', { subject: 'Mathematics', grade: 'Grade 10' });
    ok(mathematics, 200, 'search');
    const items = (
      mathematics.body as {
        items: {
          displayName: string;
          ratingAverage: number | null;
          reviewCount: number;
          pricePerHour: number;
          nextAvailableAt: string | null;
          experienceYears: number;
        }[];
      }
    ).items;
    assert.deepEqual(
      items.map((item) => item.displayName).sort(),
      ['Anan', 'Kiet', 'Mali'],
      'the 2–3 tutor comparison set',
    );
    const mali = items.find((item) => item.displayName === 'Mali');
    const kiet = items.find((item) => item.displayName === 'Kiet');
    assert.deepEqual([mali?.ratingAverage, mali?.reviewCount], [4.33, 2]);
    assert.deepEqual([kiet?.ratingAverage, kiet?.reviewCount], [4, 1]);
    for (const item of items) {
      assert.equal(typeof item.pricePerHour, 'number');
      assert.equal(typeof item.experienceYears, 'number');
    }
    const anan = await http().get(`/tutors/${tutor.id}`);
    ok(anan, 200, 'Anan profile');
    const ananBefore = (
      anan.body as { tutor: { ratingAverage: number | null; reviewCount: number } }
    ).tutor;
    assert.deepEqual([ananBefore.ratingAverage, ananBefore.reviewCount], [null, 0]);
    pass(
      'Mathematics Grade 10 offers the 3-tutor comparison set (Mali 4.33/2, Kiet 4.00/1, Anan New tutor null/0)',
    );

    // 6. Chat (US2-1/2-3 REST side).
    const conversation = await http(student.token).post('/conversations', { tutorId: tutor.id });
    assert.ok([200, 201].includes(conversation.status), JSON.stringify(conversation.body));
    const conversationId = (conversation.body as { conversationId: string }).conversationId;
    ok(
      await http(student.token).post(`/conversations/${conversationId}/messages`, {
        text: 'Hello Kru Anan, can we review quadratics next week?',
      }),
      201,
      'student message',
    );
    ok(
      await http(tutor.token).post(`/conversations/${conversationId}/read`, {}),
      200,
      'tutor reads',
    );
    pass('student messages Anan; tutor marks it read');

    // 7. Review the seeded finished class (US8-1/8-2).
    const reviewPath = `/bookings/me/${SPRINT3_DEMO_IDS.reviewReadyBooking}`;
    const own = await http(student.token).get(`${reviewPath}/review`);
    ok(own, 200, 'own review');
    assert.deepEqual(own.body, { review: null });
    ok(
      await http(student.token).post(`${reviewPath}/reviews`, {
        clarity: 5,
        punctuality: 5,
        preparation: 4,
        feedback: 'Clear examples and patient explanations.',
      }),
      201,
      'review',
    );
    const ananAfter = await http().get(`/tutors/${tutor.id}`);
    const rated = (ananAfter.body as { tutor: { ratingAverage: number; reviewCount: number } })
      .tutor;
    assert.deepEqual([rated.ratingAverage, rated.reviewCount], [4.67, 1]);
    pass('student reviews the seeded class 5/5/4; Anan now shows 4.67 from 1 review');

    // 8. Live booking with coupons and zero-net settlement (US9-2), then the class link.
    const [openSlot] = SPRINT2_DEMO_IDS.openSlots;
    assert.ok(openSlot);
    const booked = await http(student.token).post('/bookings', {
      listingId: SEEDED_MATHEMATICS_GRADE10_LISTING_ID,
      slotId: openSlot.id,
    });
    ok(booked, 201, 'book day +8');
    const bookingId = (booked.body as { id: string }).id;
    ok(await http(tutor.token).post(`/bookings/tutor/${bookingId}/confirm`), 200, 'confirm');
    const tenPercent = await http(student.token).post(`/bookings/me/${bookingId}/coupon-quote`, {
      code: 'welcome10',
    });
    ok(tenPercent, 200, 'WELCOME10 quote');
    const quoteBody = tenPercent.body as {
      subtotalAmount: string;
      discountAmount: string;
      netAmount: string;
    };
    assert.deepEqual(
      [quoteBody.subtotalAmount, quoteBody.discountAmount, quoteBody.netAmount],
      ['400.00', '40.00', '360.00'],
    );
    const tenApplied = await http(student.token).put(`/bookings/me/${bookingId}/coupon`, {
      code: 'welcome10',
    });
    ok(tenApplied, 200, 'apply WELCOME10');
    assert.equal((tenApplied.body as { netAmount: string }).netAmount, '360.00');
    const appliedCoupon = await http(student.token).put(`/bookings/me/${bookingId}/coupon`, {
      code: demoCode,
    });
    ok(appliedCoupon, 200, 'apply DEMOFREE');
    assert.equal((appliedCoupon.body as { netAmount: string }).netAmount, '0.00');
    const settled = await http(student.token).post(`/bookings/me/${bookingId}/payments/promptpay`);
    ok(settled, 200, 'zero-net settlement');
    const receipt = settled.body as {
      paymentStatus: string;
      reference: string | null;
      attempt: unknown;
    };
    assert.equal(receipt.paymentStatus, 'PAID');
    assert.match(receipt.reference ?? '', /^coupon:/);
    assert.equal(receipt.attempt, null, 'no provider attempt');
    const meetingUrl = 'https://meet.example.com/hktutor-s3-t40-rehearsal';
    ok(
      await http(tutor.token).put(`/bookings/tutor/${bookingId}/meeting-link`, { meetingUrl }),
      200,
      'meeting link',
    );
    const details = await http(student.token).get(`/bookings/${bookingId}/class-details`);
    ok(details, 200, 'class details');
    assert.equal((details.body as { meetingUrl: string }).meetingUrl, meetingUrl);
    pass(
      'book day +8 → confirm → WELCOME10 quotes and applies 400.00/40.00/360.00 → replaced by DEMOFREE, settles 0.00 PAID with no provider → link visible',
    );

    // 9. Sprint 2 ended class attendance, then the tutor report (US4-2, US7-1).
    const attendance = await http(tutor.token).put(
      `/bookings/tutor/${SPRINT2_DEMO_IDS.endedClassBooking}/attendance`,
      { attendance: 'ATTENDED' },
    );
    ok(attendance, 200, 'attendance on the seeded ended class');
    const report = await http(tutor.token).get('/reports/tutor/me');
    ok(report, 200, 'tutor report');
    const reportBody = report.body as {
      totalBookings: number;
      statusCounts: Record<string, number>;
      revenue: { amount: string };
      completionRate: { completed: number; finalized: number; percent: number | null };
    };
    const [ledger] = await db.$queryRaw<{ total: number; completed: number; revenue: string }[]>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        coalesce(sum("netAmount") FILTER (WHERE status = 'completed' AND "paymentStatus" = 'paid'), 0)::numeric(12,2)::text AS revenue
      FROM "Booking" WHERE "tutorProfileId" = ${tutor.id}::uuid
    `;
    assert.ok(ledger);
    assert.deepEqual(
      [reportBody.totalBookings, reportBody.statusCounts['COMPLETED'], reportBody.revenue.amount],
      [ledger.total, ledger.completed, ledger.revenue],
    );
    assert.ok(reportBody.completionRate.completed >= 2, 'both demo classes completed');
    ok(await http(student.token).get('/reports/tutor/me'), 403, 'student cannot read the report');
    pass(
      `tutor records attendance; report matches the database: ${reportBody.totalBookings} bookings, ${reportBody.completionRate.completed} completed, ${reportBody.revenue.amount} THB, ${String(reportBody.completionRate.percent)}%`,
    );

    process.stdout.write(`S3-T40 demo rehearsal: ${passed} checks passed.\n`);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await app?.close();
    } finally {
      await prisma?.$disconnect();
      process.env = previousEnvironment;
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Unknown failure'}\n` +
        'S3-T40 demo rehearsal failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { NodeWebSocket } from 'engine.io-client';
import 'reflect-metadata';
import { io } from 'socket.io-client';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { disposableDatabaseUrl } from '@config/disposable-database-url';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { STORAGE_CLIENT } from '@infrastructure/storage/storage.types';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { PasswordService } from '@modules/auth/password.service';
import { CHAT_SOCKET_PATH } from '@modules/conversations/conversations.socket-contract';
import { ReminderJobService } from '@modules/notifications/reminder-job.service';

import type { INestApplication, Type } from '@nestjs/common';
import type { Socket } from 'socket.io-client';
import type { App } from 'supertest/types';

/**
 * S3-T37 final journey: a student, two tutors and an admin walk discovery/comparison → real-time
 * chat → discounted PromptPay test payment → reminders → class → review → tutor report through the
 * real AppModule over HTTP and Socket.IO against PostgreSQL, followed by the cancellation,
 * rejection and reschedule regressions of the existing booking flow. Only the external providers
 * are replaced at their outermost boundary: Resend (verification emails are captured), the
 * Supabase Storage client (an in-memory private bucket) and outbound Omise HTTP (an in-process
 * test-mode charge store). Every guard, pipe, service, transaction, trigger and constraint is real.
 */
const DATABASE_NAME = 'hktutor_s3_t37_test';
const WEB_ORIGIN = 'http://localhost:3000';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function disposableSprint3IntegrationDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return disposableDatabaseUrl(env, DATABASE_NAME);
}

/**
 * Values that must never come from a developer's .env during this run. AppModule reads ../../.env
 * but process.env takes precedence, so pinning these keeps real Resend, Supabase and Omise
 * credentials out of the process even on a machine that has them configured.
 */
export function isolatedSprint3Environment(
  databaseUrl: string,
  webhookSecret: string,
): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: `s3-t37-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `s3-t37-refresh-${randomUUID()}`,
    RESEND_API_KEY: 're_s3_t37_test_only',
    EMAIL_FROM: 'HKTutor <no-reply@hktutor.test>',
    APP_URL: WEB_ORIGIN,
    WEB_ORIGIN,
    COOKIE_SECURE: 'false',
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_s3_t37_test_only',
    SUPABASE_AVATAR_BUCKET: 's3-t37-avatars',
    SUPABASE_DOCUMENT_BUCKET: 's3-t37-documents',
    PAYMENT_PROVIDER: 'omise',
    OMISE_SECRET_KEY: 'skey_test_s3t37synthetic',
    OMISE_WEBHOOK_SECRET: webhookSecret,
  };
}

/** Fields that would identify or contact a person; none may reach anonymous discovery. */
export const PRIVATE_DISCOVERY_FIELDS = [
  'email',
  'phone',
  'passwordHash',
  'firstName',
  'lastName',
  'school',
  'policyVersion',
  'consentAcceptedAt',
  'meetingUrl',
] as const;

export function privateFieldsIn(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        if ((PRIVATE_DISCOVERY_FIELDS as readonly string[]).includes(key)) {
          found.add(key);
        }
        visit(child);
      }
    }
  };
  visit(value);
  return [...found].sort();
}

const QUALIFICATION_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'.padEnd(2048, ' '),
  'latin1',
);

interface StubCharge {
  object: 'charge';
  id: string;
  livemode: false;
  amount: number;
  currency: string;
  status: 'pending' | 'successful' | 'failed' | 'expired';
  paid: boolean;
  paid_at: string | null;
  expires_at: string;
  metadata: { bookingId: string; attemptId: string };
  source: { type: 'promptpay'; scannable_code: { image: { download_uri: string } } };
}

interface Notification {
  bookingId: string | null;
  eventType: string;
  readAt: string | null;
}

interface SearchItem {
  listingId: string;
  tutorId: string;
  displayName: string;
  experienceYears: number;
  subject: string;
  grade: string;
  pricePerHour: number;
  ratingAverage: number | null;
  reviewCount: number;
  verificationStatus: string;
  nextAvailableAt: string | null;
}

async function verify(): Promise<void> {
  const databaseUrl = disposableSprint3IntegrationDatabaseUrl(process.env);
  const webhookSecret = randomBytes(32).toString('base64');
  const previousEnvironment = { ...process.env };
  Object.assign(process.env, isolatedSprint3Environment(databaseUrl, webhookSecret));
  // ConfigModule.forRoot and the reminder @Cron read the environment when AppModule is first
  // evaluated, so the module is loaded only after the isolated values above are in place.
  const { AppModule } = module.require('@app/app.module') as { AppModule: Type<unknown> };

  const sentEmails: { email: string; token: string }[] = [];
  const storedObjects = new Map<string, Buffer>();
  const bucket = (name: string) => ({
    upload: (path: string, body: Buffer) => {
      storedObjects.set(`${name}/${path}`, body);
      return Promise.resolve({ data: { path }, error: null });
    },
    remove: (paths: string[]) => {
      for (const path of paths) {
        storedObjects.delete(`${name}/${path}`);
      }
      return Promise.resolve({ data: [], error: null });
    },
    createSignedUrl: (path: string, expiresIn: number) =>
      Promise.resolve({
        data: { signedUrl: `https://storage.example.test/signed/${path}?expires=${expiresIn}` },
        error: null,
      }),
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `https://storage.example.test/public/${path}` },
    }),
  });
  const storageClient = {
    storage: {
      getBucket: () => Promise.resolve({ data: { public: false }, error: null }),
      from: bucket,
    },
  };

  // Test-mode Omise boundary: any other outbound host fails the run instead of being stubbed.
  const charges = new Map<string, StubCharge>();
  let chargeCreates = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (typeof input !== 'string') {
      throw new Error('Expected a provider URL string');
    }
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.omise.co', 'Unexpected outbound request');
    if (init?.method === 'POST') {
      chargeCreates += 1;
      assert.ok(init.body instanceof URLSearchParams);
      const form = init.body;
      const charge: StubCharge = {
        object: 'charge',
        id: `chrg_test_${randomUUID().replaceAll('-', '')}`,
        livemode: false,
        amount: Number(form.get('amount')),
        currency: 'thb',
        status: 'pending',
        paid: false,
        paid_at: null,
        expires_at: String(form.get('expires_at')),
        metadata: {
          bookingId: String(form.get('metadata[bookingId]')),
          attemptId: String(form.get('metadata[attemptId]')),
        },
        source: {
          type: 'promptpay',
          scannable_code: { image: { download_uri: 'https://api.omise.co/test.svg' } },
        },
      };
      charges.set(charge.id, charge);
      return Promise.resolve(Response.json(charge));
    }
    if (url.pathname === '/charges') {
      return Promise.resolve(Response.json({ data: [...charges.values()] }));
    }
    const charge = charges.get(url.pathname.slice('/charges/'.length));
    assert.ok(charge, 'Unknown stub charge');
    return Promise.resolve(Response.json(charge));
  };

  const run = randomUUID().slice(0, 8);
  const person = (role: string) => ({
    email: `${role}-${run}@s3-t37.invalid`,
    password: `${role}-${run}-Pass1`,
  });
  const people = {
    admin: person('admin'),
    tutorA: person('tutor-a'),
    tutorB: person('tutor-b'),
    student: person('student'),
  };
  const catalog = {
    subjectId: randomUUID(),
    subjectName: `Final Journey Physics ${run}`,
    gradeId: randomUUID(),
    gradeName: `Final Journey Grade ${run}`,
  };
  const couponCode = `S3T37${run.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;

  let app: INestApplication<App> | undefined;
  let prisma: PrismaService | undefined;
  const sockets: Socket[] = [];
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [AppModule over HTTP/Socket.IO + PostgreSQL] ${label}\n`);
  };

  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationEmail: (email: string, token: string) => {
          sentEmails.push({ email, token });
          return Promise.resolve();
        },
        sendPasswordResetEmail: () => Promise.resolve(),
      })
      .overrideProvider(STORAGE_CLIENT)
      .useValue(storageClient)
      .compile();
    // Same bootstrap as main.ts: the raw body is what Omise webhook signatures are computed over.
    app = moduleRef.createNestApplication({ rawBody: true, logger: ['error'] });
    app.use(cookieParser());
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer();
    const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const db = moduleRef.get(PrismaService);
    prisma = db;

    const target = await db.$queryRaw<{ database: string }[]>`
      SELECT current_database() AS database
    `;
    assert.deepEqual(target, [{ database: DATABASE_NAME }]);
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    const finished = new Set(applied.map((row) => row.migration_name));
    assert.deepEqual(
      committed.filter((name) => !finished.has(name)),
      [],
      'Apply all migrations first',
    );
    assert.equal(await db.user.count(), 0, 'Use a new empty disposable database');

    const http = (token?: string) => {
      const withAuth = (pending: request.Test): request.Test =>
        token ? pending.set('Authorization', `Bearer ${token}`) : pending;
      return {
        get: (path: string, query?: Record<string, string>) =>
          withAuth(
            request(server)
              .get(`/api/v1${path}`)
              .query(query ?? {}),
          ),
        post: (path: string, body?: object) => {
          const pending = withAuth(request(server).post(`/api/v1${path}`));
          return body === undefined ? pending : pending.send(body);
        },
        put: (path: string, body: object) =>
          withAuth(request(server).put(`/api/v1${path}`)).send(body),
        patch: (path: string, body: object = {}) =>
          withAuth(request(server).patch(`/api/v1${path}`)).send(body),
        delete: (path: string) => withAuth(request(server).delete(`/api/v1${path}`)),
      };
    };
    function ok(response: request.Response, status: number, label: string): void {
      assert.equal(
        response.status,
        status,
        `${label}: expected ${status}, got ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    async function notificationsFor(token: string): Promise<Notification[]> {
      const response = await http(token).get('/notifications', { limit: '50' });
      ok(response, 200, 'notification inbox');
      return (response.body as { items: Notification[] }).items;
    }
    function typesFor(items: Notification[], bookingId: string): string[] {
      return items
        .filter((item) => item.bookingId === bookingId)
        .map((item) => item.eventType)
        .sort();
    }
    function chatClient(accessToken: string): Socket {
      const socket = io(`${baseUrl}/chat`, {
        path: CHAT_SOCKET_PATH,
        auth: { accessToken },
        transports: [NodeWebSocket],
        extraHeaders: { Origin: WEB_ORIGIN },
        forceNew: true,
        reconnection: false,
        autoConnect: false,
        timeout: 5_000,
      });
      sockets.push(socket);
      return socket;
    }
    async function connect(socket: Socket): Promise<void> {
      const connected = nextEvent(socket, 'connect');
      socket.connect();
      await connected;
    }
    function nextEvent(socket: Socket, name: string): Promise<unknown> {
      return new Promise((resolveEvent, reject) => {
        const timer = setTimeout(() => reject(new Error(`No ${name} event within 5s`)), 5_000);
        socket.once(name, (payload: unknown) => {
          clearTimeout(timer);
          resolveEvent(payload);
        });
      });
    }

    // ---------------------------------------------------------------------------------------
    // 1. Accounts: public registration with captured verification; admin provisioned.
    // ---------------------------------------------------------------------------------------
    async function register(
      key: 'tutorA' | 'tutorB' | 'student',
      role: 'tutor' | 'student',
    ): Promise<{ token: string; id: string }> {
      const account = people[key];
      ok(
        await http().post('/auth/register', {
          email: account.email,
          password: account.password,
          role,
          consent: true,
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        }),
        201,
        `${key} registration`,
      );
      const email = sentEmails.find((sent) => sent.email === account.email);
      assert.ok(email, `${key} verification email was captured`);
      const verified = await http().post('/auth/verify-email', { token: email.token });
      ok(verified, 200, `${key} email verification`);
      const token = (verified.body as { accessToken: string }).accessToken;
      const me = await http(token).get('/auth/me');
      ok(me, 200, `${key} /auth/me`);
      return { token, id: (me.body as { id: string }).id };
    }
    const tutorA = await register('tutorA', 'tutor');
    const tutorB = await register('tutorB', 'tutor');
    const student = await register('student', 'student');
    await db.user.create({
      data: {
        id: randomUUID(),
        email: people.admin.email,
        passwordHash: await moduleRef.get(PasswordService).hash(people.admin.password),
        role: Role.ADMIN,
        accountStatus: AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        consentAcceptedAt: new Date(),
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      },
    });
    const adminLogin = await http().post('/auth/login', people.admin);
    ok(adminLogin, 200, 'admin login');
    const adminToken = (adminLogin.body as { accessToken: string }).accessToken;

    for (const [tutor, name, years] of [
      [tutorA, 'Kru Fah', 8],
      [tutorB, 'Kru Mek', 3],
    ] as const) {
      ok(
        await http(tutor.token).put('/profiles/me/tutor', {
          firstName: `${name.split(' ')[1] ?? name}Private`,
          lastName: 'Journey',
          nickname: name.split(' ')[1] ?? name,
          displayName: `${name} ${run}`,
          bio: 'Sprint 3 final journey tutor for mechanics and waves.',
          experienceYears: years,
        }),
        200,
        `${name} profile`,
      );
    }
    ok(
      await http(student.token).put('/profiles/me/student', {
        firstName: 'Ploy',
        lastName: 'Journey',
        nickname: 'Ploy',
        school: 'Final Journey School',
        gradeLevel: 'Grade 11',
        phone: '0812345678',
      }),
      200,
      'student profile',
    );
    pass('two tutors and a student register, verify email and onboard; admin signs in');

    // ---------------------------------------------------------------------------------------
    // 2. Admin promotion: percentage coupon with normalized, case-insensitive code.
    // ---------------------------------------------------------------------------------------
    const couponBody = {
      code: couponCode.toLowerCase(),
      percent: 10,
      maxUses: 5,
      expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    };
    ok(await http(student.token).post('/admin/coupons', couponBody), 403, 'student coupon');
    const createdCoupon = await http(adminToken).post('/admin/coupons', couponBody);
    ok(createdCoupon, 201, 'admin coupon');
    assert.equal((createdCoupon.body as { code: string }).code, couponCode);
    ok(
      await http(adminToken).post('/admin/coupons', { ...couponBody, code: couponCode }),
      409,
      'duplicate coupon code in another case',
    );
    pass(
      `admin creates ${couponCode} (10%, 5 uses); student is refused; case-insensitive duplicate 409`,
    );

    // ---------------------------------------------------------------------------------------
    // 3. Two verified tutors publish listings and availability.
    // ---------------------------------------------------------------------------------------
    await db.subject.create({
      data: { id: catalog.subjectId, code: `s3t37-${run}`, name: catalog.subjectName },
    });
    await db.gradeLevel.create({
      data: { id: catalog.gradeId, code: `s3t37-${run}`, name: catalog.gradeName, sortOrder: 98 },
    });
    const startOf = (daysAhead: number, hourBangkok: number): Date => {
      const today = new Date();
      const bangkokMidnightUtc =
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 7 * HOUR_MS;
      return new Date(bangkokMidnightUtc + daysAhead * DAY_MS + hourBangkok * HOUR_MS);
    };
    async function publishTutor(
      tutor: { token: string; id: string },
      price: number,
      slots: readonly (readonly [number, number])[],
    ): Promise<{ listingId: string; slotIds: string[] }> {
      const listing = await http(tutor.token).post('/tutors/me/listings', {
        subjectId: catalog.subjectId,
        gradeLevelId: catalog.gradeId,
        pricePerHour: price,
        description: 'Final journey physics course with weekly worked problems.',
      });
      ok(listing, 201, 'draft listing');
      const listingId = (listing.body as { id: string }).id;
      const upload = await request(server)
        .post('/api/v1/tutors/me/qualification-documents')
        .set('Authorization', `Bearer ${tutor.token}`)
        .field('documentType', 'DEGREE')
        .attach('file', QUALIFICATION_PDF, {
          filename: 'degree.pdf',
          contentType: 'application/pdf',
        });
      ok(upload, 201, 'qualification upload');
      const documentId = (upload.body as { documentId?: string }).documentId;
      assert.ok(documentId);
      ok(
        await http(adminToken).patch(`/admin/tutor-verifications/${documentId}`, {
          decision: 'APPROVED',
          reason: 'Degree certificate matches the profile.',
        }),
        200,
        'admin approval',
      );
      ok(await http(tutor.token).post(`/tutors/me/listings/${listingId}/publish`), 200, 'publish');
      const slotIds: string[] = [];
      for (const [days, hour] of slots) {
        const start = startOf(days, hour);
        const created = await http(tutor.token).post('/tutors/me/availability', {
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + HOUR_MS).toISOString(),
        });
        ok(created, 201, `availability +${days}d`);
        slotIds.push((created.body as { id: string }).id);
      }
      return { listingId, slotIds };
    }
    const offerA = await publishTutor(tutorA, 450, [
      [3, 17],
      [4, 17],
      [5, 17],
      [6, 17],
      [7, 17],
    ]);
    const offerB = await publishTutor(tutorB, 350, [[2, 18]]);
    const [classSlot, cancelSlot, rescheduleFrom, rescheduleTarget, rescheduleTarget2] =
      offerA.slotIds;
    assert.ok(classSlot && cancelSlot && rescheduleFrom && rescheduleTarget && rescheduleTarget2);
    pass('both tutors pass admin document approval and publish listings with open slots');

    // ---------------------------------------------------------------------------------------
    // 4. Discovery and the public data the 2–3 tutor comparison is built from.
    // ---------------------------------------------------------------------------------------
    const searchQuery = { subject: catalog.subjectName, grade: catalog.gradeName };
    async function search(priority?: string): Promise<SearchItem[]> {
      const response = await http().get('/tutors', {
        ...searchQuery,
        ...(priority ? { priority } : {}),
      });
      ok(response, 200, `discovery ${priority ?? ''}`);
      assert.deepEqual(privateFieldsIn(response.body), [], 'private fields in discovery');
      return (response.body as { items: SearchItem[] }).items;
    }
    const discovered = await search();
    assert.equal(discovered.length, 2);
    assert.deepEqual(
      (await search('lowest_price')).map((item) => item.tutorId),
      [tutorB.id, tutorA.id],
      '350 before 450',
    );
    assert.deepEqual(
      (await search('earliest_availability')).map((item) => item.tutorId),
      [tutorB.id, tutorA.id],
      'tomorrow+1 before +3 days',
    );
    for (const [tutor, offer, price, years, first] of [
      [tutorA, offerA, 450, 8, startOf(3, 17)],
      [tutorB, offerB, 350, 3, startOf(2, 18)],
    ] as const) {
      const item = discovered.find((row) => row.tutorId === tutor.id);
      assert.ok(item);
      assert.deepEqual(
        [item.listingId, item.pricePerHour, item.subject, item.ratingAverage, item.reviewCount],
        [offer.listingId, price, catalog.subjectName, null, 0],
      );
      assert.equal(item.experienceYears, years);
      assert.equal(new Date(item.nextAvailableAt ?? 0).toISOString(), first.toISOString());
      const detail = await http().get(`/tutors/${tutor.id}`);
      ok(detail, 200, 'public tutor detail');
      assert.deepEqual(privateFieldsIn(detail.body), [], 'private fields in public detail');
      const availability = await http().get(`/tutors/${tutor.id}/availability`);
      ok(availability, 200, 'public availability');
      assert.deepEqual(
        (availability.body as { id: string }[]).map((slot) => slot.id).sort(),
        [...offer.slotIds].sort(),
      );
    }
    pass(
      'discovery returns both tutors with price, subject, rating null/count 0, experience and next slot; sorts and hides private data',
    );

    // ---------------------------------------------------------------------------------------
    // 5. Real-time chat before booking: participant rooms, delivery and read receipts.
    // ---------------------------------------------------------------------------------------
    const opened = await http(student.token).post('/conversations', { tutorId: tutorA.id });
    ok(opened, 201, 'open conversation');
    const conversationId = (opened.body as { conversationId: string }).conversationId;
    const studentSocket = chatClient(student.token);
    const tutorSocket = chatClient(tutorA.token);
    const outsiderSocket = chatClient(tutorB.token);
    await Promise.all([connect(studentSocket), connect(tutorSocket), connect(outsiderSocket)]);
    for (const socket of [studentSocket, tutorSocket]) {
      const joined: unknown = await socket
        .timeout(5_000)
        .emitWithAck('conversation_join', { conversationId });
      assert.deepEqual(joined, { ok: true, conversationId });
    }
    const outsiderJoin: unknown = await outsiderSocket
      .timeout(5_000)
      .emitWithAck('conversation_join', { conversationId });
    assert.ok(
      typeof outsiderJoin === 'object' &&
        outsiderJoin !== null &&
        'ok' in outsiderJoin &&
        outsiderJoin.ok === false,
      'a non-participant cannot join',
    );
    const leaked: unknown[] = [];
    const echoed: unknown[] = [];
    outsiderSocket.on('message_created', (payload: unknown) => leaked.push(payload));
    studentSocket.on('message_created', (payload: unknown) => echoed.push(payload));
    const delivered = nextEvent(tutorSocket, 'message_created');
    ok(
      await http(student.token).post(`/conversations/${conversationId}/messages`, {
        text: 'Can you help with projectile motion before my exam?',
      }),
      201,
      'student message',
    );
    assert.ok(JSON.stringify(await delivered).includes('projectile motion'));
    const receipt = nextEvent(studentSocket, 'messages_read');
    ok(await http(tutorA.token).post(`/conversations/${conversationId}/read`, {}), 200, 'read');
    assert.ok(JSON.stringify(await receipt).includes(conversationId));
    ok(
      await http(adminToken).post(`/conversations/${conversationId}/messages`, { text: 'Hi' }),
      403,
      'admin cannot post',
    );
    assert.deepEqual([leaked, echoed], [[], []], 'no cross-room leakage or sender echo');
    const adminSocket = chatClient(adminToken);
    const refused = nextEvent(adminSocket, 'connect_error');
    adminSocket.connect();
    await refused;
    pass(
      'chat: tutor receives message_created live, student receives messages_read; outsider, echo and admin socket refused',
    );

    // ---------------------------------------------------------------------------------------
    // 6. Booking → confirmation → coupon → PromptPay test payment (exactly one charge).
    // ---------------------------------------------------------------------------------------
    const booked = await http(student.token).post('/bookings', {
      listingId: offerA.listingId,
      slotId: classSlot,
    });
    ok(booked, 201, 'booking');
    const bookingId = (booked.body as { id: string }).id;
    ok(
      await http(student.token).post(`/bookings/me/${bookingId}/payments/promptpay`),
      409,
      'paying a pending booking',
    );
    ok(await http(tutorA.token).post(`/bookings/tutor/${bookingId}/confirm`), 200, 'confirm');
    const couponQuote = await http(student.token).post(`/bookings/me/${bookingId}/coupon-quote`, {
      code: couponCode.toLowerCase(),
    });
    ok(couponQuote, 200, 'coupon quote');
    assert.deepEqual(
      (({ subtotalAmount, discountAmount, netAmount }) => [
        subtotalAmount,
        discountAmount,
        netAmount,
      ])(couponQuote.body as { subtotalAmount: string; discountAmount: string; netAmount: string }),
      ['450.00', '45.00', '405.00'],
    );
    const appliedCoupon = await http(student.token).put(`/bookings/me/${bookingId}/coupon`, {
      code: couponCode.toLowerCase(),
    });
    ok(appliedCoupon, 200, 'apply coupon');
    assert.equal((appliedCoupon.body as { netAmount: string }).netAmount, '405.00');
    ok(
      await http(tutorB.token).post(`/bookings/me/${bookingId}/payments/promptpay`),
      403,
      'a tutor cannot pay',
    );
    const qr = await http(student.token).post(`/bookings/me/${bookingId}/payments/promptpay`);
    ok(qr, 200, 'PromptPay QR');
    assert.equal(chargeCreates, 1);
    const charge = [...charges.values()].find((item) => item.metadata.bookingId === bookingId);
    assert.ok(charge);
    assert.equal(charge.amount, 40_500, 'Charge is the discounted 405.00 THB in satang');
    const resumed = await http(student.token).post(`/bookings/me/${bookingId}/payments/promptpay`);
    ok(resumed, 200, 'resume QR');
    assert.equal(chargeCreates, 1, 'Resuming never creates a second charge');
    ok(
      await http(student.token).delete(`/bookings/me/${bookingId}/coupon`),
      409,
      'coupon removal during an active payment',
    );
    charge.status = 'successful';
    charge.paid = true;
    charge.paid_at = new Date().toISOString();
    const webhookBody = JSON.stringify({
      object: 'event',
      livemode: false,
      key: 'charge.complete',
      data: { id: charge.id, metadata: charge.metadata },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', Buffer.from(webhookSecret, 'base64'))
      .update(`${timestamp}.${webhookBody}`)
      .digest('hex');
    const forged = await request(server)
      .post('/api/v1/payments/omise/webhook')
      .set('Content-Type', 'application/json')
      .set('Omise-Signature-Timestamp', timestamp)
      .set('Omise-Signature', '0'.repeat(64))
      .send(webhookBody);
    assert.ok([400, 401, 403].includes(forged.status), `forged webhook got ${forged.status}`);
    assert.equal(
      (await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).paymentStatus,
      'UNPAID',
      'An unsigned webhook changes nothing',
    );
    const signed = await request(server)
      .post('/api/v1/payments/omise/webhook')
      .set('Content-Type', 'application/json')
      .set('Omise-Signature-Timestamp', timestamp)
      .set('Omise-Signature', signature)
      .send(webhookBody);
    ok(signed, 200, 'signed webhook');
    const current = await http(student.token).get(`/bookings/me/${bookingId}/payments/current`);
    ok(current, 200, 'payment status');
    const receiptBody = current.body as {
      paymentStatus: string;
      netAmount: string;
      reference: string | null;
      coupon: { code: string } | null;
    };
    assert.deepEqual(
      [receiptBody.paymentStatus, receiptBody.netAmount, receiptBody.coupon?.code],
      ['PAID', '405.00', couponCode],
    );
    assert.equal(receiptBody.reference, charge.id);
    const paidAgain = await http(student.token).post(
      `/bookings/me/${bookingId}/payments/promptpay`,
    );
    ok(paidAgain, 200, 'paid retry');
    assert.equal(chargeCreates, 1, 'A paid retry returns the receipt without a new charge');
    ok(
      await http(student.token).post(`/bookings/me/${bookingId}/mock-payment`, {
        amount: '405.00',
        reference: `DEMO-${run}`,
      }),
      410,
      'retired mock payment',
    );
    const coupons = await http(adminToken).get('/admin/coupons');
    ok(coupons, 200, 'admin coupon list');
    const listed = (
      coupons.body as { items: { code: string; consumedUses: number; availableUses: number }[] }
    ).items.find((item) => item.code === couponCode);
    assert.deepEqual([listed?.consumedUses, listed?.availableUses], [1, 4]);
    pass(
      'confirmed booking: coupon 450.00 → 45.00 → 405.00; one 40500-satang charge; forged webhook ignored; signed success PAID; admin sees 1 of 5 used',
    );

    // ---------------------------------------------------------------------------------------
    // 7. Reminders, class link and attendance.
    // ---------------------------------------------------------------------------------------
    const reminders = moduleRef.get(ReminderJobService);
    const classStart = startOf(3, 17);
    const reminderRun = await reminders.runOnce(new Date(classStart.getTime() - HOUR_MS));
    assert.equal(reminderRun.failed, 0);
    const repeatRun = await reminders.runOnce(new Date(classStart.getTime() - HOUR_MS));
    assert.equal(repeatRun.created, 0, 'Repeated reminder run creates nothing');
    const studentReminderTypes = typesFor(await notificationsFor(student.token), bookingId).filter(
      (type) => type.includes('REMINDER'),
    );
    const tutorReminderTypes = typesFor(await notificationsFor(tutorA.token), bookingId).filter(
      (type) => type.includes('REMINDER'),
    );
    assert.deepEqual(
      [studentReminderTypes, tutorReminderTypes],
      [['CLASS_REMINDER_1H'], ['CLASS_REMINDER_1H']],
    );
    const meetingUrl = `https://meet.example.com/hktutor-s3-${run}`;
    ok(
      await http(tutorA.token).put(`/bookings/tutor/${bookingId}/meeting-link`, { meetingUrl }),
      200,
      'meeting link',
    );
    ok(
      await http(tutorA.token).put(`/bookings/tutor/${bookingId}/attendance`, {
        attendance: 'ATTENDED',
      }),
      409,
      'attendance before the class ends',
    );
    await db.availabilitySlot.update({
      where: { id: classSlot },
      data: {
        startAtUtc: new Date(Date.now() - 2 * HOUR_MS),
        endAtUtc: new Date(Date.now() - HOUR_MS),
      },
    });
    ok(
      await http(student.token).post(`/bookings/me/${bookingId}/reviews`, {
        clarity: 5,
        punctuality: 5,
        preparation: 5,
        feedback: 'Too early',
      }),
      409,
      'review before completion',
    );
    const attended = await http(tutorA.token).put(`/bookings/tutor/${bookingId}/attendance`, {
      attendance: 'ATTENDED',
    });
    ok(attended, 200, 'attendance');
    assert.equal((attended.body as { status: string }).status, 'COMPLETED');
    const classDetails = await http(student.token).get(`/bookings/${bookingId}/class-details`);
    ok(classDetails, 200, 'class details');
    assert.equal((classDetails.body as { meetingUrl: string }).meetingUrl, meetingUrl);
    pass(
      'paid class gets one 1H reminder per party (idempotent rerun); link; attended → COMPLETED',
    );

    // ---------------------------------------------------------------------------------------
    // 8. Detailed review updates public rating, count, ranking and the authentic review list.
    // ---------------------------------------------------------------------------------------
    const feedback = '<b>Clear</b> explanations & great practice problems';
    const mine = await http(student.token).get(`/bookings/me/${bookingId}/review`);
    ok(mine, 200, 'own review before submit');
    assert.deepEqual(mine.body, { review: null });
    const reviewed = await http(student.token).post(`/bookings/me/${bookingId}/reviews`, {
      clarity: 5,
      punctuality: 4,
      preparation: 5,
      feedback: `  ${feedback}  `,
    });
    ok(reviewed, 201, 'review');
    ok(
      await http(student.token).post(`/bookings/me/${bookingId}/reviews`, {
        clarity: 1,
        punctuality: 1,
        preparation: 1,
        feedback: 'Second attempt',
      }),
      409,
      'one review per booking',
    );
    const ratedDetail = await http().get(`/tutors/${tutorA.id}`);
    ok(ratedDetail, 200, 'rated detail');
    const ratedTutor = (
      ratedDetail.body as { tutor: { ratingAverage: number; reviewCount: number } }
    ).tutor;
    assert.deepEqual([ratedTutor.ratingAverage, ratedTutor.reviewCount], [4.67, 1]);
    assert.equal(
      (await search('highest_rating'))[0]?.tutorId,
      tutorA.id,
      'reviewed tutor ranks first',
    );
    const publicReviews = await http().get(`/tutors/${tutorA.id}/reviews`);
    ok(publicReviews, 200, 'public reviews');
    const reviewItems = (publicReviews.body as { items: { feedback: string }[] }).items;
    assert.deepEqual(
      reviewItems.map((item) => item.feedback),
      [feedback],
      'Feedback is trimmed and stored as text, never rewritten as HTML',
    );
    assert.deepEqual(privateFieldsIn(publicReviews.body), []);
    pass(
      'review 5/4/5 → public 4.67 from 1 review, ranks first by rating; duplicate 409; text preserved',
    );

    // ---------------------------------------------------------------------------------------
    // 9. Regression: cancellation, rejection and reschedule on the existing booking flow.
    // ---------------------------------------------------------------------------------------
    const publicSlots = async (): Promise<string[]> => {
      const response = await http().get(`/tutors/${tutorA.id}/availability`);
      ok(response, 200, 'public availability');
      return (response.body as { id: string }[]).map((slot) => slot.id);
    };
    const toCancel = await http(student.token).post('/bookings', {
      listingId: offerA.listingId,
      slotId: cancelSlot,
    });
    ok(toCancel, 201, 'second booking');
    const cancelId = (toCancel.body as { id: string }).id;
    ok(await http(tutorA.token).post(`/bookings/tutor/${cancelId}/confirm`), 200, 'confirm 2');
    const reuse = await http(student.token).put(`/bookings/me/${cancelId}/coupon`, {
      code: couponCode,
    });
    ok(reuse, 409, 'the same student reusing a consumed coupon');
    assert.equal((reuse.body as { code: string }).code, 'COUPON_ALREADY_USED');
    ok(
      await http(student.token).post(`/bookings/${cancelId}/cancel`, { reason: 'School trip' }),
      200,
      'cancel',
    );
    assert.ok((await publicSlots()).includes(cancelSlot), 'Cancellation released the slot');
    assert.deepEqual(typesFor(await notificationsFor(tutorA.token), cancelId), [
      'BOOKING_CANCELED',
      'BOOKING_CREATED',
    ]);
    const rebooked = await http(student.token).post('/bookings', {
      listingId: offerA.listingId,
      slotId: cancelSlot,
    });
    ok(rebooked, 201, 'rebook released slot');
    const rebookedId = (rebooked.body as { id: string }).id;
    ok(await http(tutorA.token).post(`/bookings/tutor/${rebookedId}/reject`), 200, 'reject');
    assert.ok((await publicSlots()).includes(cancelSlot), 'Rejection released the slot');

    const toMove = await http(student.token).post('/bookings', {
      listingId: offerA.listingId,
      slotId: rescheduleFrom,
    });
    ok(toMove, 201, 'third booking');
    const moveId = (toMove.body as { id: string }).id;
    ok(await http(tutorA.token).post(`/bookings/tutor/${moveId}/confirm`), 200, 'confirm 3');
    const firstRequest = await http(student.token).post(`/bookings/${moveId}/reschedule-requests`, {
      targetSlotId: rescheduleTarget,
      reason: 'Exam moved',
    });
    ok(firstRequest, 201, 'reschedule request');
    const firstRequestId = (firstRequest.body as { requestId: string }).requestId;
    ok(
      await http(student.token).post(`/bookings/${moveId}/reschedule-requests`, {
        targetSlotId: rescheduleTarget2,
      }),
      409,
      'second pending request',
    );
    ok(
      await http(tutorA.token).post(`/reschedule-requests/${firstRequestId}/reject`, {
        reason: 'That time is taken',
      }),
      200,
      'reject reschedule',
    );
    const secondRequest = await http(student.token).post(
      `/bookings/${moveId}/reschedule-requests`,
      {
        targetSlotId: rescheduleTarget,
      },
    );
    ok(secondRequest, 201, 'second reschedule request');
    const secondRequestId = (secondRequest.body as { requestId: string }).requestId;
    ok(
      await http(tutorA.token).post(`/reschedule-requests/${secondRequestId}/approve`),
      200,
      'approve reschedule',
    );
    const moved = await db.booking.findUniqueOrThrow({
      where: { id: moveId },
      select: { slotId: true, status: true },
    });
    assert.deepEqual(moved, { slotId: rescheduleTarget, status: 'CONFIRMED' });
    const afterMove = await publicSlots();
    assert.ok(afterMove.includes(rescheduleFrom) && !afterMove.includes(rescheduleTarget));
    const couponAfter = await http(adminToken).get('/admin/coupons');
    const couponRow = (
      couponAfter.body as { items: { code: string; consumedUses: number }[] }
    ).items.find((item) => item.code === couponCode);
    assert.equal(couponRow?.consumedUses, 1, 'Refused reuse and cancellations consume no use');
    pass(
      'coupon reuse by the same student 409; cancel releases the slot and notifies; rebook+reject; reschedule duplicate 409, reject, approve swaps slots',
    );

    // ---------------------------------------------------------------------------------------
    // 10. Tutor report reflects the whole persisted journey; other roles cannot read it.
    // ---------------------------------------------------------------------------------------
    const reportA = await http(tutorA.token).get('/reports/tutor/me');
    ok(reportA, 200, 'tutor A report');
    assert.deepEqual(reportA.body, {
      totalBookings: 4,
      statusCounts: { PENDING: 0, CONFIRMED: 1, COMPLETED: 1, CANCELED: 2, EXPIRED: 0 },
      revenue: { amount: '405.00', currency: 'THB' },
      completionRate: { completed: 1, finalized: 3, percent: 33.33 },
    });
    const reportB = await http(tutorB.token).get('/reports/tutor/me');
    ok(reportB, 200, 'tutor B report');
    assert.deepEqual(
      (reportB.body as { totalBookings: number; completionRate: { percent: null } }).completionRate
        .percent,
      null,
    );
    ok(await http(student.token).get('/reports/tutor/me'), 403, 'student report');
    ok(await http(adminToken).get('/reports/tutor/me'), 403, 'admin report');
    ok(
      await http(tutorB.token).get('/reports/tutor/me', { tutorId: tutorA.id }),
      400,
      "another tutor's report",
    );
    pass(
      'tutor A report: 4 bookings (1 completed, 2 canceled, 1 confirmed), discounted 405.00 THB, 1/3 = 33.33%; tutor B empty; others refused',
    );

    // ---------------------------------------------------------------------------------------
    // 11. Cross-cutting invariants after the whole journey.
    // ---------------------------------------------------------------------------------------
    for (const [token, owner] of [
      [student.token, student.id],
      [tutorA.token, tutorA.id],
    ] as const) {
      const inbox = await db.notification.findMany({
        where: { userId: owner },
        select: { eventKey: true },
      });
      assert.ok(inbox.length > 0);
      assert.equal(new Set(inbox.map((row) => row.eventKey)).size, inbox.length);
      ok(await http(token).post('/notifications/read-all'), 200, 'read all');
      assert.equal(
        (await notificationsFor(token)).filter((item) => item.readAt === null).length,
        0,
      );
    }
    const ledger = await db.booking.findMany({
      where: { tutorProfileId: tutorA.id },
      select: { status: true, paymentStatus: true, netAmount: true },
      orderBy: { createdAt: 'asc' },
    });
    assert.deepEqual(
      ledger.map((row) => [row.status, row.paymentStatus, row.netAmount.toFixed(2)]),
      [
        ['COMPLETED', 'PAID', '405.00'],
        ['CANCELED', 'UNPAID', '450.00'],
        ['CANCELED', 'UNPAID', '450.00'],
        ['CONFIRMED', 'UNPAID', '450.00'],
      ],
    );
    assert.equal(await db.couponUse.count({ where: { coupon: { code: couponCode } } }), 1);
    assert.equal(await db.review.count({ where: { tutorProfileId: tutorA.id } }), 1);
    assert.equal(chargeCreates, 1);
    pass('final state: one paid charge, one coupon use, one review; unique unread-free inboxes');

    process.stdout.write(
      `S3-T37 Sprint 3 journey verification: ${passed} checks passed (run ${run}).\n`,
    );
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
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
        'S3-T37 Sprint 3 journey verification failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

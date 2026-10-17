import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role, TutorVerificationStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { STORAGE_CLIENT } from '@infrastructure/storage/storage.types';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { PasswordService } from '@modules/auth/password.service';

import type { INestApplication, Type } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * S2-T38 integration: one student, one tutor and one admin walk the whole Sprint 2 product through
 * the real AppModule over HTTP against PostgreSQL, followed by the cancellation and reschedule
 * regression paths. Only the two external providers are replaced at their outermost boundary:
 * Resend (verification emails are captured instead of sent) and the Supabase Storage client (an
 * in-memory private bucket). Every guard, pipe, service, transaction and constraint is real.
 */

export function disposableIntegrationDatabaseUrl(env: NodeJS.ProcessEnv): string {
  assert.equal(
    env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable opt-in required',
  );
  const value = env['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[_-].*[_-]test$/);
  assert.equal(url.search, '', 'URL options are not accepted');
  assert.equal(url.hash, '', 'URL fragments are not accepted');
  return value;
}

/**
 * Values that must never come from a developer's .env during this run. AppModule reads ../../.env,
 * and process.env takes precedence over it, so pinning these keeps real Supabase/Resend
 * credentials out of the process even on a machine that has them configured.
 */
export function isolatedEnvironment(databaseUrl: string): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: `integration-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `integration-refresh-${randomUUID()}`,
    RESEND_API_KEY: 're_integration_test_only',
    EMAIL_FROM: 'HKTutor <no-reply@hktutor.test>',
    APP_URL: 'http://localhost:3000',
    WEB_ORIGIN: 'http://localhost:3000',
    COOKIE_SECURE: 'false',
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_integration_test_only',
    SUPABASE_AVATAR_BUCKET: 'integration-avatars',
    SUPABASE_DOCUMENT_BUCKET: 'integration-documents',
  };
}

/** A minimal valid PDF: the storage service checks the file signature, not just the MIME type. */
const QUALIFICATION_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'.padEnd(2048, ' '),
  'latin1',
);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface Notification {
  bookingId: string | null;
  eventType: string;
  readAt: string | null;
}

async function verify(): Promise<void> {
  const databaseUrl = disposableIntegrationDatabaseUrl(process.env);
  Object.assign(process.env, isolatedEnvironment(databaseUrl));
  // ConfigModule.forRoot reads the environment when AppModule is first evaluated, so the module
  // is loaded only after the isolated values above are in place.
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

  const run = randomUUID().slice(0, 8);
  const people = {
    admin: { email: `admin-${run}@integration.invalid`, password: `Admin-${run}-pass1` },
    tutor: { email: `tutor-${run}@integration.invalid`, password: `Tutor-${run}-pass1` },
    student: { email: `student-${run}@integration.invalid`, password: `Student-${run}-pass1` },
  };
  const catalog = {
    subjectId: randomUUID(),
    subjectName: `Integration Mathematics ${run}`,
    gradeId: randomUUID(),
    gradeName: `Integration Grade ${run}`,
  };

  let app: INestApplication<App> | undefined;
  let prisma: PrismaService | undefined;
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [AppModule over HTTP + PostgreSQL] ${label}\n`);
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
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    const server = app.getHttpServer();
    const db = moduleRef.get(PrismaService);
    prisma = db;

    const target = await db.$queryRaw<{ database: string }[]>`
      SELECT current_database() AS database
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)) },
    ]);
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
        post: (path: string, body: object = {}) =>
          withAuth(request(server).post(`/api/v1${path}`)).send(body),
        put: (path: string, body: object) =>
          withAuth(request(server).put(`/api/v1${path}`)).send(body),
        patch: (path: string, body: object = {}) =>
          withAuth(request(server).patch(`/api/v1${path}`)).send(body),
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

    // ---------------------------------------------------------------------------------------
    // 1. Accounts: public registration with captured email verification; admin provisioned.
    // ---------------------------------------------------------------------------------------
    async function register(role: 'student' | 'tutor'): Promise<string> {
      const person = people[role];
      const registered = await http().post('/auth/register', {
        email: person.email,
        password: person.password,
        role,
        consent: true,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      });
      ok(registered, 201, `${role} registration`);
      const email = sentEmails.find((sent) => sent.email === person.email);
      assert.ok(email, `${role} verification email was captured`);
      const verified = await http().post('/auth/verify-email', { token: email.token });
      ok(verified, 200, `${role} email verification`);
      const replay = await http().post('/auth/verify-email', { token: email.token });
      assert.equal(replay.status, 400, 'A verification token is single-use');
      return (verified.body as { accessToken: string }).accessToken;
    }
    const tutorToken = await register('tutor');
    const studentToken = await register('student');

    const adminId = randomUUID();
    await db.user.create({
      data: {
        id: adminId,
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
    const tutorLogin = await http().post('/auth/login', people.tutor);
    ok(tutorLogin, 200, 'tutor login with the registered password');

    const tutorMe = await http(tutorToken).get('/auth/me');
    const studentMe = await http(studentToken).get('/auth/me');
    ok(tutorMe, 200, 'tutor /auth/me');
    ok(studentMe, 200, 'student /auth/me');
    const tutorId = (tutorMe.body as { id: string }).id;
    const studentId = (studentMe.body as { id: string }).id;

    ok(
      await http(tutorToken).put('/profiles/me/tutor', {
        firstName: 'Anan',
        lastName: 'Integration',
        nickname: 'Anan',
        displayName: `Kru Anan ${run}`,
        bio: 'Sprint 2 integration tutor teaching algebra and calculus.',
        experienceYears: 6,
      }),
      200,
      'tutor profile',
    );
    ok(
      await http(studentToken).put('/profiles/me/student', {
        firstName: 'Nan',
        lastName: 'Integration',
        nickname: 'Nan',
        school: 'Integration School',
        gradeLevel: 'Grade 10',
        phone: '0812345678',
      }),
      200,
      'student profile',
    );
    pass('tutor and student register, verify email once and onboard; admin signs in');

    // ---------------------------------------------------------------------------------------
    // 2. Verification gate: an unverified tutor cannot publish or be discovered until approved.
    // ---------------------------------------------------------------------------------------
    await db.subject.create({
      data: { id: catalog.subjectId, code: `int-${run}`, name: catalog.subjectName },
    });
    await db.gradeLevel.create({
      data: { id: catalog.gradeId, code: `int-${run}`, name: catalog.gradeName, sortOrder: 99 },
    });
    const listingResponse = await http(tutorToken).post('/tutors/me/listings', {
      subjectId: catalog.subjectId,
      gradeLevelId: catalog.gradeId,
      pricePerHour: 450,
      description: 'Integration algebra course with weekly practice problems.',
    });
    ok(listingResponse, 201, 'draft listing');
    const listingId = (listingResponse.body as { id: string }).id;
    const earlyPublish = await http(tutorToken).post(`/tutors/me/listings/${listingId}/publish`);
    ok(earlyPublish, 403, 'unverified publish is refused');

    const startOf = (daysAhead: number, hourBangkok: number): Date => {
      const today = new Date();
      const bangkokMidnightUtc =
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - 7 * HOUR_MS;
      return new Date(bangkokMidnightUtc + daysAhead * DAY_MS + hourBangkok * HOUR_MS);
    };
    const slotIds: string[] = [];
    for (const [days, hour] of [
      [3, 17],
      [4, 17],
      [5, 17],
      [6, 17],
      [7, 17],
    ] as const) {
      const start = startOf(days, hour);
      const created = await http(tutorToken).post('/tutors/me/availability', {
        startAt: start.toISOString(),
        endAt: new Date(start.getTime() + HOUR_MS).toISOString(),
      });
      ok(created, 201, `availability day +${days}`);
      slotIds.push((created.body as { id: string }).id);
    }
    const [classSlot, cancelSlot, rescheduleFrom, rescheduleTarget, rescheduleTarget2] = slotIds;
    assert.ok(classSlot && cancelSlot && rescheduleFrom && rescheduleTarget && rescheduleTarget2);

    const searchQuery = { subject: catalog.subjectName, grade: catalog.gradeName };
    const hiddenSearch = await http().get('/tutors', searchQuery);
    ok(hiddenSearch, 200, 'discovery before verification');
    assert.equal((hiddenSearch.body as { total: number }).total, 0, 'Draft listing is hidden');

    const upload = await request(server)
      .post('/api/v1/tutors/me/qualification-documents')
      .set('Authorization', `Bearer ${tutorToken}`)
      .field('documentType', 'DEGREE')
      .attach('file', QUALIFICATION_PDF, {
        filename: 'degree.pdf',
        contentType: 'application/pdf',
      });
    ok(upload, 201, 'qualification upload');
    const documentId = (upload.body as { documentId?: string; id?: string }).documentId;
    assert.ok(documentId, JSON.stringify(upload.body));
    assert.equal(storedObjects.size, 1, 'The PDF reached the private bucket');

    const queue = await http(adminToken).get('/admin/tutor-verifications', { status: 'PENDING' });
    ok(queue, 200, 'admin verification queue');
    assert.ok(JSON.stringify(queue.body).includes(documentId), 'Document is queued for review');
    const studentReview = await http(studentToken).patch(
      `/admin/tutor-verifications/${documentId}`,
      { decision: 'APPROVED' },
    );
    ok(studentReview, 403, 'student cannot review');
    const review = await http(adminToken).patch(`/admin/tutor-verifications/${documentId}`, {
      decision: 'APPROVED',
      reason: 'Degree certificate matches the profile.',
    });
    ok(review, 200, 'admin approval');
    assert.equal(
      (review.body as { tutorVerificationStatus: string }).tutorVerificationStatus,
      'VERIFIED',
    );
    ok(
      await http(tutorToken).post(`/tutors/me/listings/${listingId}/publish`),
      200,
      'verified publish',
    );
    pass(
      'unverified tutor is hidden and cannot publish; admin approves the PDF; listing publishes',
    );

    // ---------------------------------------------------------------------------------------
    // 3. Discovery: the verified tutor is found, ranked, badged and shows bookable slots.
    // ---------------------------------------------------------------------------------------
    const search = await http().get('/tutors', {
      ...searchQuery,
      maxPrice: '500',
      priority: 'earliest_availability',
    });
    ok(search, 200, 'discovery');
    const results = (
      search.body as {
        items: {
          listingId: string;
          recommendationTags: string[];
          tutorId: string;
          verificationStatus: string;
        }[];
      }
    ).items;
    assert.equal(results.length, 1, JSON.stringify(search.body));
    assert.equal(results[0]?.tutorId, tutorId);
    assert.equal(results[0]?.listingId, listingId);
    assert.equal(results[0]?.verificationStatus, 'VERIFIED');
    const overBudget = await http().get('/tutors', { ...searchQuery, maxPrice: '449.99' });
    assert.equal((overBudget.body as { total: number }).total, 0, 'Budget filter is inclusive');
    const profile = await http().get(`/tutors/${tutorId}`);
    ok(profile, 200, 'public tutor profile');
    assert.ok(JSON.stringify(profile.body).includes('VERIFIED'), 'Profile carries the badge');
    const publicSlots = async (): Promise<string[]> => {
      const response = await http().get(`/tutors/${tutorId}/availability`);
      ok(response, 200, 'public availability');
      return (response.body as { id: string }[]).map((slot) => slot.id);
    };
    assert.deepEqual((await publicSlots()).sort(), [...slotIds].sort());
    pass('student discovers the verified tutor by subject, grade and budget with all 5 open slots');

    // ---------------------------------------------------------------------------------------
    // 4. Chat before booking, with read receipts.
    // ---------------------------------------------------------------------------------------
    const opened = await http(studentToken).post('/conversations', { tutorId });
    ok(opened, 201, 'open conversation');
    const conversationId = (opened.body as { conversationId: string }).conversationId;
    const reopened = await http(studentToken).post('/conversations', { tutorId });
    ok(reopened, 200, 'reopening returns the existing conversation');
    assert.equal(
      (reopened.body as { conversationId: string }).conversationId,
      conversationId,
      'One conversation per student-tutor pair',
    );
    const question = await http(studentToken).post(`/conversations/${conversationId}/messages`, {
      text: 'Do you teach quadratic equations?',
    });
    ok(question, 201, 'student message');
    const tutorInbox = await http(tutorToken).get('/conversations');
    ok(tutorInbox, 200, 'tutor conversation list');
    assert.ok(JSON.stringify(tutorInbox.body).includes(conversationId));
    const tutorReads = await http(tutorToken).get(`/conversations/${conversationId}/messages`);
    ok(tutorReads, 200, 'tutor history');
    ok(
      await http(tutorToken).post(`/conversations/${conversationId}/read`, {}),
      200,
      'tutor marks read',
    );
    ok(
      await http(tutorToken).post(`/conversations/${conversationId}/messages`, {
        text: 'Yes, every week. Book any open slot.',
      }),
      201,
      'tutor reply',
    );
    const history = await http(studentToken).get(`/conversations/${conversationId}/messages`);
    const messages = (history.body as { items: { readAt: string | null; senderId: string }[] })
      .items;
    assert.equal(messages.length, 2);
    assert.ok(
      messages.find((message) => message.senderId === studentId)?.readAt,
      "Student's question shows as read",
    );
    ok(
      await http(adminToken).post(`/conversations/${conversationId}/messages`, { text: 'Hi' }),
      403,
      'admin cannot post',
    );
    pass('student asks before booking, tutor reads and replies; read receipt reaches the student');

    // ---------------------------------------------------------------------------------------
    // 5. Booking -> confirmation -> mock payment -> class link -> attendance.
    // ---------------------------------------------------------------------------------------
    const quote = await http(studentToken).get('/bookings/quote', { listingId, slotId: classSlot });
    ok(quote, 200, 'quote');
    const netAmount = (quote.body as { netAmount: string }).netAmount;
    assert.equal(netAmount, '450.00');
    const booked = await http(studentToken).post('/bookings', { listingId, slotId: classSlot });
    ok(booked, 201, 'booking');
    const bookingId = (booked.body as { id: string; status: string }).id;
    assert.equal((booked.body as { status: string }).status, 'PENDING');
    assert.ok(!(await publicSlots()).includes(classSlot), 'A pending booking reserves the slot');
    ok(
      await http(tutorToken).post('/bookings', { listingId, slotId: cancelSlot }),
      403,
      'tutor cannot book',
    );
    assert.deepEqual(typesFor(await notificationsFor(tutorToken), bookingId), ['BOOKING_CREATED']);

    const earlyPay = await http(studentToken).post(`/bookings/me/${bookingId}/mock-payment`, {
      amount: netAmount,
      reference: `DEMO-${run}-EARLY`,
    });
    ok(earlyPay, 400, 'paying a pending booking');
    ok(await http(tutorToken).post(`/bookings/tutor/${bookingId}/confirm`), 200, 'confirm');
    assert.deepEqual(typesFor(await notificationsFor(studentToken), bookingId), [
      'BOOKING_CONFIRMED',
    ]);

    const paid = await http(studentToken).post(`/bookings/me/${bookingId}/mock-payment`, {
      amount: netAmount,
      reference: `DEMO-${run}-0001`,
    });
    ok(paid, 200, 'mock payment');
    assert.equal((paid.body as { paymentStatus: string }).paymentStatus, 'PAID');
    const repay = await http(studentToken).post(`/bookings/me/${bookingId}/mock-payment`, {
      amount: netAmount,
      reference: `DEMO-${run}-0002`,
    });
    ok(repay, 409, 'second payment');

    const meetingUrl = `https://meet.example.com/hktutor-${run}`;
    ok(
      await http(tutorToken).put(`/bookings/tutor/${bookingId}/meeting-link`, { meetingUrl }),
      200,
      'meeting link',
    );
    const studentClass = await http(studentToken).get(`/bookings/${bookingId}/class-details`);
    ok(studentClass, 200, 'student class details');
    assert.equal((studentClass.body as { meetingUrl: string }).meetingUrl, meetingUrl);
    const earlyAttendance = await http(tutorToken).put(`/bookings/tutor/${bookingId}/attendance`, {
      attendance: 'ATTENDED',
    });
    ok(earlyAttendance, 409, 'attendance before the class ends');

    // Time travel: move this one slot into the past so the class has ended.
    await db.availabilitySlot.update({
      where: { id: classSlot },
      data: {
        startAtUtc: new Date(Date.now() - 2 * HOUR_MS),
        endAtUtc: new Date(Date.now() - HOUR_MS),
      },
    });
    const attended = await http(tutorToken).put(`/bookings/tutor/${bookingId}/attendance`, {
      attendance: 'ATTENDED',
    });
    ok(attended, 200, 'attendance');
    assert.equal((attended.body as { status: string }).status, 'COMPLETED');
    const finalClass = await http(studentToken).get(`/bookings/${bookingId}/class-details`);
    const finalBody = finalClass.body as {
      attendance: string;
      meetingUrl: string;
      status: string;
    };
    assert.deepEqual(
      [finalBody.status, finalBody.attendance, finalBody.meetingUrl],
      ['COMPLETED', 'ATTENDED', meetingUrl],
    );
    const studentBooking = await http(studentToken).get(`/bookings/me/${bookingId}`);
    const studentBookingBody = studentBooking.body as { paymentStatus: string; status: string };
    assert.deepEqual(
      [studentBookingBody.status, studentBookingBody.paymentStatus],
      ['COMPLETED', 'PAID'],
    );
    pass(
      'book -> notify tutor -> confirm -> notify student -> pay once -> class link -> attended -> COMPLETED',
    );

    // ---------------------------------------------------------------------------------------
    // 6. Regression: cancellation releases the slot, notifies the other party, and rebooks.
    // ---------------------------------------------------------------------------------------
    const toCancel = await http(studentToken).post('/bookings', { listingId, slotId: cancelSlot });
    ok(toCancel, 201, 'second booking');
    const cancelId = (toCancel.body as { id: string }).id;
    ok(await http(tutorToken).post(`/bookings/tutor/${cancelId}/confirm`), 200, 'confirm second');
    const noReason = await http(studentToken).post(`/bookings/${cancelId}/cancel`, {
      reason: '  ',
    });
    ok(noReason, 400, 'cancel without a reason');
    const canceled = await http(studentToken).post(`/bookings/${cancelId}/cancel`, {
      reason: 'School event',
    });
    ok(canceled, 200, 'cancel');
    assert.ok((await publicSlots()).includes(cancelSlot), 'Cancellation released the slot');
    assert.deepEqual(typesFor(await notificationsFor(tutorToken), cancelId), [
      'BOOKING_CANCELED',
      'BOOKING_CREATED',
    ]);
    assert.deepEqual(typesFor(await notificationsFor(studentToken), cancelId), [
      'BOOKING_CONFIRMED',
    ]);
    const rebooked = await http(studentToken).post('/bookings', { listingId, slotId: cancelSlot });
    ok(rebooked, 201, 'rebook the released slot');
    const rebookedId = (rebooked.body as { id: string }).id;
    ok(await http(tutorToken).post(`/bookings/tutor/${rebookedId}/reject`), 200, 'tutor rejects');
    assert.ok((await publicSlots()).includes(cancelSlot), 'Rejection released the slot again');
    assert.deepEqual(typesFor(await notificationsFor(studentToken), rebookedId), [
      'BOOKING_REJECTED',
    ]);
    pass(
      'cancel needs a reason, releases the slot and notifies; the slot is rebooked and rejected',
    );

    // ---------------------------------------------------------------------------------------
    // 7. Regression: reschedule reject keeps the booking; approve swaps slots atomically.
    // ---------------------------------------------------------------------------------------
    const toMove = await http(studentToken).post('/bookings', {
      listingId,
      slotId: rescheduleFrom,
    });
    ok(toMove, 201, 'third booking');
    const moveId = (toMove.body as { id: string }).id;
    ok(await http(tutorToken).post(`/bookings/tutor/${moveId}/confirm`), 200, 'confirm third');
    const firstRequest = await http(studentToken).post(`/bookings/${moveId}/reschedule-requests`, {
      targetSlotId: rescheduleTarget,
      reason: 'Exam moved',
    });
    ok(firstRequest, 201, 'reschedule request');
    const firstRequestId = (firstRequest.body as { requestId: string }).requestId;
    const duplicate = await http(studentToken).post(`/bookings/${moveId}/reschedule-requests`, {
      targetSlotId: rescheduleTarget2,
    });
    ok(duplicate, 409, 'second pending request');
    ok(
      await http(studentToken).post(`/reschedule-requests/${firstRequestId}/approve`),
      403,
      'student cannot approve',
    );
    ok(
      await http(tutorToken).post(`/reschedule-requests/${firstRequestId}/reject`, {
        reason: 'That time is taken',
      }),
      200,
      'tutor rejects reschedule',
    );
    const afterReject = await http(studentToken).get(`/bookings/me/${moveId}`);
    assert.ok(JSON.stringify(afterReject.body).includes(rescheduleFrom), 'Booking did not move');

    const secondRequest = await http(studentToken).post(`/bookings/${moveId}/reschedule-requests`, {
      targetSlotId: rescheduleTarget,
    });
    ok(secondRequest, 201, 'second reschedule request');
    const secondRequestId = (secondRequest.body as { requestId: string }).requestId;
    ok(
      await http(tutorToken).post(`/reschedule-requests/${secondRequestId}/approve`),
      200,
      'tutor approves reschedule',
    );
    const moved = await db.booking.findUniqueOrThrow({
      where: { id: moveId },
      select: { slotId: true, status: true },
    });
    assert.deepEqual(moved, { slotId: rescheduleTarget, status: 'CONFIRMED' });
    const slotsAfterMove = await publicSlots();
    assert.ok(slotsAfterMove.includes(rescheduleFrom), 'Old slot released');
    assert.ok(!slotsAfterMove.includes(rescheduleTarget), 'New slot reserved');
    assert.deepEqual(typesFor(await notificationsFor(studentToken), moveId), [
      'BOOKING_CONFIRMED',
      'RESCHEDULE_APPROVED',
      'RESCHEDULE_REJECTED',
    ]);
    assert.deepEqual(typesFor(await notificationsFor(tutorToken), moveId), [
      'BOOKING_CREATED',
      'RESCHEDULE_REQUESTED',
      'RESCHEDULE_REQUESTED',
    ]);
    pass('reschedule: duplicate 409, reject keeps the slot, approve swaps slots and notifies both');

    // ---------------------------------------------------------------------------------------
    // 8. Regression: losing verification hides the tutor and blocks new bookings only.
    // ---------------------------------------------------------------------------------------
    // There is no revoke endpoint (see verify-tutor-verification-visibility.ts), so the status a
    // future admin action would write is set directly. The listing stays PUBLISHED throughout,
    // so discovery can only hide it through the verification filter itself.
    await db.tutorProfile.update({
      where: { userId: tutorId },
      data: { verificationStatus: TutorVerificationStatus.REJECTED },
    });
    // Plain search and every ranking priority take different query paths; check them all.
    for (const priority of [undefined, 'lowest_price', 'highest_rating', 'earliest_availability']) {
      const revokedSearch = await http().get('/tutors', {
        ...searchQuery,
        ...(priority ? { priority } : {}),
      });
      ok(revokedSearch, 200, `discovery after revocation (${priority ?? 'no priority'})`);
      assert.equal(
        (revokedSearch.body as { total: number }).total,
        0,
        `Revoked tutor is hidden (${priority ?? 'no priority'})`,
      );
    }
    ok(await http().get(`/tutors/${tutorId}`), 404, 'revoked public profile');
    const revokedBooking = await http(studentToken).post('/bookings', {
      listingId,
      slotId: rescheduleFrom,
    });
    ok(revokedBooking, 409, 'booking a revoked tutor');
    // The rescheduled booking moved off this slot, so no booking may reference it now.
    assert.equal(await db.booking.count({ where: { slotId: rescheduleFrom } }), 0, 'No new row');
    const stillMine = await http(studentToken).get(`/bookings/${moveId}/class-details`);
    ok(stillMine, 200, 'existing booking stays readable after revocation');
    assert.equal((stillMine.body as { status: string }).status, 'CONFIRMED');
    const listingRow = await db.teachingListing.findUniqueOrThrow({
      where: { id: listingId },
      select: { publicationStatus: true },
    });
    assert.equal(listingRow.publicationStatus, 'PUBLISHED', 'Listing is hidden, not deleted');
    await db.tutorProfile.update({
      where: { userId: tutorId },
      data: { verificationStatus: TutorVerificationStatus.VERIFIED },
    });
    const restored = await http().get('/tutors', searchQuery);
    assert.equal((restored.body as { total: number }).total, 1, 'Re-verification restores it');
    pass('revoking verification hides the tutor and blocks new bookings; existing booking intact');

    // ---------------------------------------------------------------------------------------
    // 9. Cross-cutting invariants after the whole journey.
    // ---------------------------------------------------------------------------------------
    for (const [token, owner] of [
      [studentToken, studentId],
      [tutorToken, tutorId],
    ] as const) {
      const inbox = await db.notification.findMany({
        where: { userId: owner },
        select: { eventKey: true },
      });
      assert.ok(inbox.length > 0);
      // Self-notifications are excluded by the per-booking type assertions above; here every
      // stored event must also be unique for its recipient.
      assert.equal(new Set(inbox.map((row) => row.eventKey)).size, inbox.length);
      const unread = (await notificationsFor(token)).filter((item) => item.readAt === null);
      assert.ok(unread.length > 0);
      ok(await http(token).post('/notifications/read-all'), 200, 'read all');
      assert.equal(
        (await notificationsFor(token)).filter((item) => item.readAt === null).length,
        0,
      );
    }
    const bookings = await db.booking.findMany({
      where: { tutorProfileId: tutorId },
      select: { id: true, paymentStatus: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    assert.deepEqual(
      bookings.map((row) => [row.status, row.paymentStatus]),
      [
        ['COMPLETED', 'PAID'],
        ['CANCELED', 'UNPAID'],
        ['CANCELED', 'UNPAID'],
        ['CONFIRMED', 'UNPAID'],
      ],
    );
    pass('final state: 1 completed+paid, 2 canceled, 1 confirmed; no self or duplicate notices');

    process.stdout.write(
      `Passed ${passed} Sprint 2 integration checks (run ${run}, tutor ${tutorId}, ` +
        `student ${studentId}, completed booking ${bookingId}).\n`,
    );
  } finally {
    // Qualification audit rows are append-only by design, so this runner does not delete its
    // fixtures. Run it against a fresh disposable database and discard that database afterwards.
    await app?.close();
    await prisma?.$disconnect();
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Unknown failure'}\n` +
        'Sprint 2 integration verification failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

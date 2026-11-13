import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import {
  AttendanceStatus,
  BookingStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { EmailService } from '@infrastructure/email/email.service';
import { STORAGE_CLIENT } from '@infrastructure/storage/storage.types';
import { CURRENT_PRIVACY_POLICY_VERSION, REFRESH_COOKIE_NAME } from '@modules/auth/auth.constants';
import {
  EMAIL_RESEND_WAIT_SECONDS,
  EmailFlowService,
  emailFlowCookieName,
} from '@modules/auth/email-flow.service';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { CHAT_SOCKET_PATH } from '@modules/conversations/conversations.socket-contract';

import type { INestApplication, Type } from '@nestjs/common';
import type { Socket } from 'socket.io-client';
import type { App } from 'supertest/types';

/**
 * S3-T38 final regression: authentication, privacy, authorization and race-sensitive writes across
 * every Sprint 1–3 feature, through the real AppModule over HTTP and Socket.IO against PostgreSQL.
 * Feature-level verifiers already prove each rule in depth; this runner re-checks them together
 * on one database so a cross-feature regression (a new route without a guard, a consent check
 * dropped from one module, a socket that survives logout) fails one final command.
 */
const DATABASE_NAME = 'hktutor_s3_t38_test';
const WEB_ORIGIN = 'http://localhost:3000';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const XSS = '<script>alert("x")</script><img src=x onerror=alert(1)>';

export function disposableSecurityDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return disposableDatabaseUrl(env, DATABASE_NAME);
}

export function isolatedSecurityEnvironment(databaseUrl: string): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: `s3-t38-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `s3-t38-refresh-${randomUUID()}`,
    RESEND_API_KEY: 're_s3_t38_test_only',
    EMAIL_FROM: 'HKTutor <no-reply@hktutor.test>',
    APP_URL: WEB_ORIGIN,
    WEB_ORIGIN,
    COOKIE_SECURE: 'false',
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_s3_t38_test_only',
    SUPABASE_AVATAR_BUCKET: 's3-t38-avatars',
    SUPABASE_DOCUMENT_BUCKET: 's3-t38-documents',
    // No payment provider: payment routes still authenticate and authorize before configuration.
    OMISE_SECRET_KEY: '',
    OMISE_WEBHOOK_SECRET: '',
  };
}

/** Parses one Set-Cookie header for the refresh cookie without trusting its order. */
export function refreshCookieFrom(setCookie: readonly string[] | undefined): {
  value: string;
  attributes: Set<string>;
} | null {
  const header = setCookie?.find((line) => line.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!header) {
    return null;
  }
  const [pair = '', ...rest] = header.split(';').map((part) => part.trim());
  const value = decodeURIComponent(pair.slice(REFRESH_COOKIE_NAME.length + 1));
  return { value, attributes: new Set(rest.map((part) => part.toLowerCase())) };
}

function setCookies(response: request.Response): string[] | undefined {
  const header: unknown = response.headers['set-cookie'];
  return Array.isArray(header) ? header.map(String) : undefined;
}

async function verify(): Promise<void> {
  const databaseUrl = disposableSecurityDatabaseUrl(process.env);
  const previousEnvironment = { ...process.env };
  Object.assign(process.env, isolatedSecurityEnvironment(databaseUrl));
  const { AppModule } = module.require('@app/app.module') as { AppModule: Type<unknown> };

  const sentEmails: { email: string; token: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('No outbound request is allowed in S3-T38'));
  const storageClient = {
    storage: {
      getBucket: () => Promise.resolve({ data: { public: false }, error: null }),
      from: () => ({
        upload: () => Promise.reject(new Error('Storage is not used by S3-T38')),
        remove: () => Promise.resolve({ data: [], error: null }),
        createSignedUrl: () => Promise.reject(new Error('Storage is not used by S3-T38')),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.example.test/${path}` },
        }),
      }),
    },
  };

  const run = randomUUID().slice(0, 8);
  let app: INestApplication<App> | undefined;
  let prisma: PrismaService | undefined;
  const sockets: Socket[] = [];
  const matrix: string[] = [];
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
    app = moduleRef.createNestApplication({ rawBody: true, logger: ['error'] });
    app.use(cookieParser());
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer();
    const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const db = moduleRef.get(PrismaService);
    prisma = db;
    const tokens = moduleRef.get(JwtTokenService);

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

    const http = (token?: string, cookie?: string) => {
      const prepare = (pending: request.Test): request.Test => {
        let next = token ? pending.set('Authorization', `Bearer ${token}`) : pending;
        if (cookie !== undefined) {
          next = next.set('Cookie', `${REFRESH_COOKIE_NAME}=${encodeURIComponent(cookie)}`);
        }
        return next;
      };
      return {
        get: (path: string, query?: Record<string, string>) =>
          prepare(
            request(server)
              .get(`/api/v1${path}`)
              .query(query ?? {}),
          ),
        post: (path: string, body?: object) => {
          const pending = prepare(request(server).post(`/api/v1${path}`));
          return body === undefined ? pending : pending.send(body);
        },
        put: (path: string, body: object) =>
          prepare(request(server).put(`/api/v1${path}`)).send(body),
        patch: (path: string, body: object = {}) =>
          prepare(request(server).patch(`/api/v1${path}`)).send(body),
        delete: (path: string) => prepare(request(server).delete(`/api/v1${path}`)),
      };
    };
    function ok(response: request.Response, status: number, label: string): void {
      assert.equal(
        response.status,
        status,
        `${label}: expected ${status}, got ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    function code(response: request.Response): unknown {
      const body: unknown = response.body;
      return typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined;
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
    function nextEvent(socket: Socket, name: string): Promise<unknown> {
      return new Promise((resolveEvent, reject) => {
        const timer = setTimeout(() => reject(new Error(`No ${name} event within 5s`)), 5_000);
        socket.once(name, (payload: unknown) => {
          clearTimeout(timer);
          resolveEvent(payload);
        });
      });
    }
    async function connect(socket: Socket): Promise<void> {
      const connected = nextEvent(socket, 'connect');
      socket.connect();
      await connected;
    }
    async function refused(socket: Socket): Promise<void> {
      const failed = nextEvent(socket, 'connect_error');
      socket.connect();
      await failed;
    }

    // ---------------------------------------------------------------------------------------
    // 1. Refresh cookie contract, rotation and reuse detection.
    // ---------------------------------------------------------------------------------------
    const password = `Sec-${run}-Pass1`;
    const studentEmail = `student-${run}@s3-t38.invalid`;
    ok(
      await http().post('/auth/register', {
        email: studentEmail,
        password,
        role: 'student',
        consent: true,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      }),
      201,
      'register',
    );
    const verification = sentEmails.find((sent) => sent.email === studentEmail);
    assert.ok(verification);
    const verified = await http().post('/auth/verify-email', { token: verification.token });
    ok(verified, 200, 'verify');
    assert.ok(!('refreshToken' in (verified.body as object)), 'refresh token never in a body');
    const c1 = refreshCookieFrom(setCookies(verified));
    assert.ok(c1, 'refresh cookie set');
    for (const attribute of ['httponly', 'path=/', 'samesite=lax']) {
      assert.ok(c1.attributes.has(attribute), `refresh cookie ${attribute}`);
    }
    const [storedSession] = await db.$queryRaw<{ hash: string; dump: string }[]>`
      SELECT "refreshTokenHash" AS hash, to_jsonb(s)::text AS dump
      FROM "AuthSession" s JOIN "User" u ON u.id = s."userId" WHERE u.email = ${studentEmail}
    `;
    assert.ok(storedSession);
    assert.match(storedSession.hash, /^[0-9a-f]{64}$/);
    assert.ok(!storedSession.dump.includes(c1.value), 'raw refresh token is never stored');
    assert.equal(storedSession.hash, createHash('sha256').update(c1.value).digest('hex'));
    ok(await http(c1.value).get('/auth/me'), 401, 'refresh token used as a Bearer access token');
    const accessToken = (verified.body as { accessToken: string }).accessToken;
    ok(await http(undefined, accessToken).post('/auth/refresh'), 401, 'access token as cookie');

    const rotated = await http(undefined, c1.value).post('/auth/refresh');
    ok(rotated, 200, 'refresh');
    const c2 = refreshCookieFrom(setCookies(rotated));
    assert.ok(c2 && c2.value !== c1.value, 'refresh rotates the cookie');
    const rotatedAccess = (rotated.body as { accessToken: string }).accessToken;
    ok(await http(rotatedAccess).get('/auth/me'), 200, 'rotated access token');
    ok(await http(undefined, c1.value).post('/auth/refresh'), 401, 'replayed old refresh token');
    ok(await http(undefined, c2.value).post('/auth/refresh'), 401, 'family revoked after reuse');
    ok(await http(rotatedAccess).get('/auth/me'), 401, 'access token of the revoked session');
    pass(
      'refresh cookie HttpOnly/Path=/ /SameSite=Lax, only its SHA-256 stored; rotation; replay revokes the whole session and its access token',
    );

    const login = await http().post('/auth/login', { email: studentEmail, password });
    ok(login, 200, 'login');
    const d1 = refreshCookieFrom(setCookies(login));
    assert.ok(d1);
    const raced = await Promise.all(
      Array.from({ length: 5 }, () => http(undefined, d1.value).post('/auth/refresh')),
    );
    assert.deepEqual(
      raced.map((response) => response.status).sort(),
      [200, 401, 401, 401, 401],
      'exactly one concurrent refresh wins',
    );
    const loginTwo = await http().post('/auth/login', { email: studentEmail, password });
    ok(loginTwo, 200, 'second login');
    const e1 = refreshCookieFrom(setCookies(loginTwo));
    assert.ok(e1);
    const sessionAccess = (loginTwo.body as { accessToken: string }).accessToken;
    const liveSocket = chatClient(sessionAccess);
    await connect(liveSocket);
    const dropped = nextEvent(liveSocket, 'disconnect');
    const logout = await http(undefined, e1.value).post('/auth/logout');
    ok(logout, 204, 'logout');
    assert.ok(
      (setCookies(logout) ?? []).some((line) => line.startsWith(`${REFRESH_COOKIE_NAME}=;`)),
      'logout clears the cookie',
    );
    await dropped;
    ok(await http(undefined, e1.value).post('/auth/refresh'), 401, 'refresh after logout');
    ok(await http(sessionAccess).get('/auth/me'), 401, 'access token after logout');
    pass(
      '5 concurrent refreshes: exactly one 200; logout clears the cookie, kills access and disconnects the live socket',
    );

    // ---------------------------------------------------------------------------------------
    // 2. Email verification and login throttling.
    // ---------------------------------------------------------------------------------------
    const pendingEmail = `pending-${run}@s3-t38.invalid`;
    ok(
      await http().post('/auth/register', {
        email: pendingEmail,
        password,
        role: 'tutor',
        consent: true,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      }),
      201,
      'register unverified',
    );
    const unverifiedLogin = await http().post('/auth/login', { email: pendingEmail, password });
    ok(unverifiedLogin, 403, 'unverified login');
    assert.equal(refreshCookieFrom(setCookies(unverifiedLogin)), null, 'no session before verify');
    ok(await http().post('/auth/verify-email', { token: verification.token }), 400, 'reused token');
    const pendingToken = sentEmails.find((sent) => sent.email === pendingEmail);
    assert.ok(pendingToken);
    // Expire the token and move it outside the 60-second reissue window, so a resend may issue a
    // replacement.
    await db.emailVerificationToken.updateMany({
      where: { user: { email: pendingEmail } },
      data: { expiresAt: new Date(Date.now() - 60_000), createdAt: new Date(Date.now() - 120_000) },
    });
    ok(
      await http().post('/auth/verify-email', { token: pendingToken.token }),
      400,
      'expired token',
    );
    assert.equal(
      (await db.user.findFirstOrThrow({ where: { email: pendingEmail } })).emailVerifiedAt,
      null,
    );
    // Resend needs the signed verification-flow cookie and its flowId, as the browser sends them.
    // The real EmailFlowService signs each flow; only its clock is moved past the resend wait, so
    // the flow is ready instead of cooling down.
    const emailFlows = moduleRef.get(EmailFlowService);
    function readyVerificationFlow(email: string) {
      const realNow = Date.now;
      Date.now = () => realNow() - (EMAIL_RESEND_WAIT_SECONDS + 1) * 1000;
      try {
        return emailFlows.create(email, 'verification');
      } finally {
        Date.now = realNow;
      }
    }
    async function resend(email: string): Promise<request.Response> {
      const ready = readyVerificationFlow(email);
      const cookie = `${emailFlowCookieName('verification')}=${encodeURIComponent(ready.cookie)}`;
      return request(server)
        .post('/api/v1/auth/resend-verification')
        .set('Cookie', cookie)
        .send({ flowId: ready.flow.id });
    }
    function publicResendFields(response: request.Response) {
      const body = response.body as {
        message?: unknown;
        emailFlow?: { purpose?: unknown; retryAfterSeconds?: unknown };
      };
      return {
        status: response.status,
        keys: Object.keys(response.body as object).sort(),
        message: body.message,
        purpose: body.emailFlow?.purpose,
        retryAfterSeconds: body.emailFlow?.retryAfterSeconds,
      };
    }
    const unknownEmail = `nobody-${run}@s3-t38.invalid`;
    const emailsBefore = sentEmails.length;
    const known = await resend(pendingEmail);
    const unknown = await resend(unknownEmail);
    ok(known, 200, 'resend for an eligible account');
    ok(unknown, 200, 'resend for an unknown account');
    assert.deepEqual(publicResendFields(known), publicResendFields(unknown), 'no enumeration');
    assert.equal(
      publicResendFields(known).message,
      'If the account can be verified, a verification email has been sent.',
    );
    const replacements = sentEmails.slice(emailsBefore);
    assert.deepEqual(
      replacements.map((sent) => sent.email),
      [pendingEmail],
      'only the eligible account receives a replacement email',
    );
    const [replacement] = replacements;
    assert.ok(replacement && replacement.token !== pendingToken.token);
    assert.equal(
      await db.emailVerificationToken.count({
        where: { user: { email: pendingEmail }, consumedAt: null },
      }),
      1,
      'the replacement supersedes the old token',
    );
    ok(
      await http().post('/auth/verify-email', { token: replacement.token }),
      200,
      'replacement token verifies',
    );
    const wrong = { email: studentEmail, password: 'Wrong-password-1' };
    ok(await http().post('/auth/login', wrong), 401, 'wrong password 4');
    ok(await http().post('/auth/login', wrong), 401, 'wrong password 5');
    ok(await http().post('/auth/login', { email: studentEmail, password }), 429, '6th login');
    pass(
      'unverified login 403 without a cookie; reused and expired verification tokens 400; signed-flow resend answers known and unknown alike and only the eligible account gets a working replacement; 6th login in a minute 429',
    );

    // ---------------------------------------------------------------------------------------
    // 3. Fixture: two students, two tutors, one admin with real sessions (no further logins).
    // ---------------------------------------------------------------------------------------
    async function actor(
      role: Role,
      label: string,
    ): Promise<{ id: string; token: string; sessionId: string }> {
      const id = randomUUID();
      await db.user.create({
        data: {
          id,
          role,
          email: `${label}-${run}@s3-t38.invalid`,
          emailVerifiedAt: new Date(),
          consentAcceptedAt: new Date(),
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        },
      });
      const session = await db.authSession.create({
        data: {
          userId: id,
          expiresAt: new Date(Date.now() + DAY_MS),
          refreshTokenHash: randomBytes(32).toString('hex'),
        },
      });
      return { id, sessionId: session.id, token: tokens.signAccessToken(id, session.id, role) };
    }
    const s1 = await actor(Role.STUDENT, 's1');
    const s2 = await actor(Role.STUDENT, 's2');
    const t1 = await actor(Role.TUTOR, 't1');
    const t2 = await actor(Role.TUTOR, 't2');
    const admin = await actor(Role.ADMIN, 'admin');
    for (const [student, nickname] of [
      [s1, 'One'],
      [s2, 'Two'],
    ] as const) {
      ok(
        await http(student.token).put('/profiles/me/student', {
          firstName: `Private${nickname}`,
          lastName: 'Security',
          nickname,
          school: `Private School ${nickname}`,
          gradeLevel: 'Grade 12',
          phone: '0899999999',
        }),
        200,
        'student profile',
      );
    }
    const subjectId = randomUUID();
    const gradeId = randomUUID();
    await db.subject.create({
      data: { id: subjectId, code: `s3t38-${run}`, name: `Security ${run}` },
    });
    await db.gradeLevel.create({
      data: { id: gradeId, code: `s3t38-${run}`, name: `Grade ${run}`, sortOrder: 97 },
    });
    const listings: Record<string, string> = {};
    const slots: Record<string, string[]> = {};
    for (const [tutor, key] of [
      [t1, 't1'],
      [t2, 't2'],
    ] as const) {
      ok(
        await http(tutor.token).put('/profiles/me/tutor', {
          firstName: 'Private',
          lastName: 'Tutor',
          nickname: key,
          displayName: `${XSS} ${key}`,
          bio: `Bio with markup ${XSS}`,
          experienceYears: 4,
        }),
        200,
        'tutor profile',
      );
      await db.tutorProfile.update({
        where: { userId: tutor.id },
        data: { verificationStatus: TutorVerificationStatus.VERIFIED },
      });
      const listing = await http(tutor.token).post('/tutors/me/listings', {
        subjectId,
        gradeLevelId: gradeId,
        pricePerHour: 400,
        description: 'Security regression listing with enough descriptive text.',
      });
      ok(listing, 201, 'listing');
      listings[key] = (listing.body as { id: string }).id;
      ok(
        await http(tutor.token).post(`/tutors/me/listings/${listings[key]}/publish`),
        200,
        'publish',
      );
      slots[key] = [];
      for (let day = 3; day <= 6; day += 1) {
        const start = new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + day * DAY_MS);
        const slot = await http(tutor.token).post('/tutors/me/availability', {
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + HOUR_MS).toISOString(),
        });
        ok(slot, 201, 'slot');
        (slots[key] ?? []).push((slot.body as { id: string }).id);
      }
    }
    const [slot0, slot1, slot2, slot3] = slots['t1'] ?? [];
    assert.ok(slot0 && slot1 && slot2 && slot3, 'four t1 slots');
    const t1Listing = listings['t1'] ?? '';
    const booking = await http(s1.token).post('/bookings', {
      listingId: t1Listing,
      slotId: slot0,
    });
    ok(booking, 201, 's1 booking');
    const bookingId = (booking.body as { id: string }).id;
    const conversation = await http(s1.token).post('/conversations', { tutorId: t1.id });
    ok(conversation, 201, 'conversation');
    const conversationId = (conversation.body as { conversationId: string }).conversationId;
    const s1Notification = await db.notification.findFirst({ where: { userId: t1.id } });
    assert.ok(s1Notification, 'tutor has a booking notification');
    pass(
      'fixture: 2 students, 2 verified tutors with listings/slots, 1 admin; s1 books t1 and opens a chat',
    );

    // ---------------------------------------------------------------------------------------
    // 4. Authorization matrix: 401 before 403, and no foreign access changes state.
    // ---------------------------------------------------------------------------------------
    const before = await db.$queryRaw<{ digest: string }[]>`
      SELECT md5(coalesce(string_agg(to_jsonb(b)::text, ',' ORDER BY id), '')) AS digest FROM "Booking" b
    `;
    type Call = [label: string, send: (token?: string) => request.Test, foreign: string];
    const calls: Call[] = [
      ['GET booking', (t) => http(t).get(`/bookings/me/${bookingId}`), s2.token],
      [
        'POST coupon-quote',
        (t) => http(t).post(`/bookings/me/${bookingId}/coupon-quote`, { code: 'WELCOME10' }),
        s2.token,
      ],
      [
        'PUT coupon',
        (t) => http(t).put(`/bookings/me/${bookingId}/coupon`, { code: 'WELCOME10' }),
        s2.token,
      ],
      [
        'POST payment',
        (t) => http(t).post(`/bookings/me/${bookingId}/payments/promptpay`),
        s2.token,
      ],
      ['GET payment', (t) => http(t).get(`/bookings/me/${bookingId}/payments/current`), s2.token],
      [
        'POST review',
        (t) =>
          http(t).post(`/bookings/me/${bookingId}/reviews`, {
            clarity: 5,
            punctuality: 5,
            preparation: 5,
            feedback: 'x',
          }),
        s2.token,
      ],
      ['GET review', (t) => http(t).get(`/bookings/me/${bookingId}/review`), s2.token],
      [
        'POST cancel',
        (t) => http(t).post(`/bookings/${bookingId}/cancel`, { reason: 'Not mine' }),
        s2.token,
      ],
      ['GET class-details', (t) => http(t).get(`/bookings/${bookingId}/class-details`), s2.token],
      [
        'POST reschedule',
        (t) => http(t).post(`/bookings/${bookingId}/reschedule-requests`, { targetSlotId: slot1 }),
        s2.token,
      ],
      ['POST confirm', (t) => http(t).post(`/bookings/tutor/${bookingId}/confirm`), t2.token],
      ['POST reject', (t) => http(t).post(`/bookings/tutor/${bookingId}/reject`), t2.token],
      [
        'PUT meeting-link',
        (t) =>
          http(t).put(`/bookings/tutor/${bookingId}/meeting-link`, {
            meetingUrl: 'https://meet.example.com/x',
          }),
        t2.token,
      ],
      [
        'PUT attendance',
        (t) => http(t).put(`/bookings/tutor/${bookingId}/attendance`, { attendance: 'ATTENDED' }),
        t2.token,
      ],
      [
        'POST confirm as student',
        (t) => http(t).post(`/bookings/tutor/${bookingId}/confirm`),
        s1.token,
      ],
      ['GET messages', (t) => http(t).get(`/conversations/${conversationId}/messages`), s2.token],
      [
        'POST message',
        (t) => http(t).post(`/conversations/${conversationId}/messages`, { text: 'intrude' }),
        t2.token,
      ],
      ['POST read', (t) => http(t).post(`/conversations/${conversationId}/read`, {}), s2.token],
      [
        'PATCH notification',
        (t) => http(t).patch(`/notifications/${s1Notification.id}/read`),
        s2.token,
      ],
      ['GET tutor report', (t) => http(t).get('/reports/tutor/me'), s1.token],
      ['GET admin coupons', (t) => http(t).get('/admin/coupons'), t1.token],
      [
        'POST admin coupon',
        (t) =>
          http(t).post('/admin/coupons', {
            code: 'HACK10',
            percent: 10,
            maxUses: 1,
            expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
          }),
        s1.token,
      ],
      ['GET admin verifications', (t) => http(t).get('/admin/tutor-verifications'), t1.token],
      [
        'POST listing as student',
        (t) =>
          http(t).post('/tutors/me/listings', {
            subjectId,
            gradeLevelId: gradeId,
            pricePerHour: 1,
            description: 'Not a tutor listing at all',
          }),
        s1.token,
      ],
      [
        'POST booking as admin',
        (t) => http(t).post('/bookings', { listingId: t1Listing, slotId: slot2 }),
        admin.token,
      ],
    ];
    for (const [label, send, foreign] of calls) {
      const anonymous = await send();
      ok(anonymous, 401, `${label} anonymous`);
      const denied = await send(foreign);
      assert.ok(
        [403, 404].includes(denied.status),
        `${label} foreign: got ${denied.status} ${JSON.stringify(denied.body)}`,
      );
      matrix.push(
        `${label}: anonymous 401, foreign/wrong role ${denied.status} ${String(code(denied))}`,
      );
    }
    const injected = await http(s2.token).post('/bookings', {
      listingId: t1Listing,
      slotId: slot3,
      studentUserId: s1.id,
    });
    ok(injected, 400, 'studentUserId body injection');
    const after = await db.$queryRaw<{ digest: string }[]>`
      SELECT md5(coalesce(string_agg(to_jsonb(b)::text, ',' ORDER BY id), '')) AS digest FROM "Booking" b
    `;
    assert.deepEqual(after, before, 'no foreign call changed any booking');
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: s1Notification.id } })).readAt,
      null,
    );
    assert.equal(await db.message.count({ where: { conversationId } }), 0, 'no intruding message');
    assert.equal(await db.coupon.count(), 0, 'no coupon was created');
    pass(
      `${calls.length} protected routes: anonymous 401, foreign owner or wrong role 403/404; body identity injection 400; no state changed`,
    );

    // ---------------------------------------------------------------------------------------
    // 5. Current privacy consent gates private features until re-accepted.
    // ---------------------------------------------------------------------------------------
    await db.user.update({ where: { id: s1.id }, data: { policyVersion: '2000-01-01' } });
    await db.user.update({
      where: { id: t1.id },
      data: { consentAcceptedAt: null, policyVersion: null },
    });
    const gated: [string, request.Response, number, RegExp][] = [
      [
        'coupon apply',
        await http(s1.token).put(`/bookings/me/${bookingId}/coupon`, { code: 'NONE10' }),
        403,
        /^Accept the current privacy notice to continue\.$/,
      ],
      [
        'payment create',
        await http(s1.token).post(`/bookings/me/${bookingId}/payments/promptpay`),
        403,
        /^Accept the current privacy notice to continue\.$/,
      ],
      [
        'chat send',
        await http(s1.token).post(`/conversations/${conversationId}/messages`, { text: 'hi' }),
        403,
        /^Accept the current privacy notice to continue\.$/,
      ],
      [
        'review create',
        await http(s1.token).post(`/bookings/me/${bookingId}/reviews`, {
          clarity: 5,
          punctuality: 5,
          preparation: 5,
          feedback: 'x',
        }),
        403,
        /^Accept the current privacy notice to continue\.$/,
      ],
      [
        'own profile',
        await http(s1.token).get('/profiles/me'),
        400,
        /^Accept the current privacy notice before viewing a profile$/,
      ],
      [
        'reschedule request',
        await http(s1.token).post(`/bookings/${bookingId}/reschedule-requests`, {
          targetSlotId: slot2,
        }),
        400,
        /^Accept the current privacy notice before requesting or acting on a reschedule$/,
      ],
      [
        'tutor report',
        await http(t1.token).get('/reports/tutor/me'),
        403,
        /^Accept the current privacy notice to continue\.$/,
      ],
      [
        'tutor chat read',
        await http(t1.token).post(`/conversations/${conversationId}/read`, {}),
        403,
        /^Accept the current privacy notice to continue\.$/,
      ],
    ];
    for (const [label, response, status, message] of gated) {
      ok(response, status, `${label} with outdated or missing consent`);
      assert.match(String((response.body as { message?: unknown }).message), message, label);
    }
    // Sprint 1–2 booking reads never opted into the consent guard; record them as a finding.
    for (const [label, response] of [
      ['GET /bookings/me/:bookingId', await http(s1.token).get(`/bookings/me/${bookingId}`)],
      ['GET /bookings/tutor', await http(t1.token).get('/bookings/tutor')],
    ] as const) {
      matrix.push(`FINDING consent not required: ${label} → ${response.status}`);
    }
    ok(await http(s1.token).get('/auth/me'), 200, '/auth/me stays reachable to re-accept');
    ok(
      await http(s1.token).post('/auth/consent', { consent: true, policyVersion: '2000-01-01' }),
      400,
      'old version',
    );
    ok(
      await http(s1.token).post('/auth/consent', {
        consent: true,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      }),
      200,
      're-accept',
    );
    ok(await http(s1.token).get(`/bookings/me/${bookingId}`), 200, 'booking after re-accept');
    await db.user.update({
      where: { id: t1.id },
      data: { consentAcceptedAt: new Date(), policyVersion: CURRENT_PRIVACY_POLICY_VERSION },
    });
    pass(
      `outdated or missing consent refused on ${gated.length} gated routes (coupon, payment, chat send/read, review, profile, reschedule, report) until /auth/consent accepts the current version`,
    );

    // ---------------------------------------------------------------------------------------
    // 6. Socket isolation.
    // ---------------------------------------------------------------------------------------
    const expired = tokens.signAccessToken(s1.id, s1.sessionId, Role.STUDENT);
    await db.authSession.update({
      where: { id: s1.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await refused(chatClient(expired));
    await db.authSession.update({
      where: { id: s1.sessionId },
      data: { expiresAt: new Date(Date.now() + DAY_MS) },
    });
    await refused(chatClient(c1.value));
    await refused(chatClient(admin.token));
    await refused(chatClient('not-a-jwt'));
    const s1Socket = chatClient(s1.token);
    const t1Socket = chatClient(t1.token);
    const s2Socket = chatClient(s2.token);
    await Promise.all([connect(s1Socket), connect(t1Socket), connect(s2Socket)]);
    for (const socket of [s1Socket, t1Socket]) {
      assert.deepEqual(
        await socket.timeout(5_000).emitWithAck('conversation_join', { conversationId }),
        { ok: true, conversationId },
      );
    }
    const intruder: unknown = await s2Socket
      .timeout(5_000)
      .emitWithAck('conversation_join', { conversationId });
    assert.ok(
      typeof intruder === 'object' &&
        intruder !== null &&
        'ok' in intruder &&
        intruder.ok === false,
    );
    const otherConversation = await http(s2.token).post('/conversations', { tutorId: t2.id });
    ok(otherConversation, 201, 's2 conversation');
    const otherId = (otherConversation.body as { conversationId: string }).conversationId;
    const leaked: unknown[] = [];
    s2Socket.on('message_created', (payload: unknown) => leaked.push(payload));
    s1Socket.on('message_created', (payload: unknown) => leaked.push(payload));
    const delivered = nextEvent(t1Socket, 'message_created');
    ok(
      await http(s1.token).post(`/conversations/${conversationId}/messages`, { text: XSS }),
      201,
      'xss message',
    );
    const payload = await delivered;
    assert.ok(
      JSON.stringify(payload).includes(JSON.stringify(XSS).slice(1, -1)),
      'socket payload keeps text',
    );
    ok(
      await http(s2.token).post(`/conversations/${otherId}/messages`, { text: 'other room' }),
      201,
      'other room',
    );
    await new Promise((settle) => setTimeout(settle, 300));
    assert.deepEqual(leaked, [], 'no cross-room delivery or sender echo');
    pass(
      'socket: expired, refresh-as-access, admin and malformed tokens refused; non-participant join refused; no cross-room leakage',
    );

    // ---------------------------------------------------------------------------------------
    // 7. Stored markup is returned as inert JSON text everywhere it is read back.
    // ---------------------------------------------------------------------------------------
    const history = await http(t1.token).get(`/conversations/${conversationId}/messages`);
    ok(history, 200, 'history');
    assert.match(String(history.headers['content-type']), /^application\/json/);
    assert.equal((history.body as { items: { text: string }[] }).items[0]?.text, XSS);
    const publicTutor = await http().get(`/tutors/${t1.id}`);
    ok(publicTutor, 200, 'public tutor');
    assert.match(String(publicTutor.headers['content-type']), /^application\/json/);
    assert.ok(JSON.stringify(publicTutor.body).includes(JSON.stringify(`${XSS} t1`).slice(1, -1)));
    for (const key of ['firstName', 'lastName', 'school', 'phone', 'email']) {
      assert.ok(!JSON.stringify(publicTutor.body).includes(`"${key}"`), `public tutor ${key}`);
    }
    const ownProfile = await http(s2.token).get('/profiles/me');
    ok(ownProfile, 200, 'own profile');
    assert.ok(!JSON.stringify(ownProfile.body).includes('PrivateOne'), "another student's profile");
    const me = await http(s2.token).get('/auth/me');
    assert.deepEqual(Object.keys(me.body as object).sort(), ['email', 'id', 'role']);
    pass(
      'markup in chat, display name and bio round-trips as exact JSON text; public and /auth/me payloads stay minimal',
    );

    // ---------------------------------------------------------------------------------------
    // 8. Race-sensitive writes keep one winner.
    // ---------------------------------------------------------------------------------------
    const contested = slot1;
    const bookingRace = await Promise.all(
      [s1, s2, s1, s2].map((student) =>
        http(student.token).post('/bookings', { listingId: t1Listing, slotId: contested }),
      ),
    );
    assert.deepEqual(bookingRace.map((response) => response.status).sort(), [201, 409, 409, 409]);
    assert.equal(
      await db.booking.count({
        where: {
          slotId: contested,
          status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        },
      }),
      1,
    );
    const confirmRace = await Promise.all(
      Array.from({ length: 3 }, () => http(t1.token).post(`/bookings/tutor/${bookingId}/confirm`)),
    );
    assert.deepEqual(confirmRace.map((response) => response.status).sort(), [200, 409, 409]);
    assert.equal(
      await db.notification.count({ where: { bookingId, eventType: 'BOOKING_CONFIRMED' } }),
      1,
      'one confirmation notice',
    );
    await db.availabilitySlot.update({
      where: { id: slot0 },
      data: {
        startAtUtc: new Date(Date.now() - 2 * HOUR_MS),
        endAtUtc: new Date(Date.now() - HOUR_MS),
      },
    });
    await db.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.COMPLETED,
        attendance: AttendanceStatus.ATTENDED,
        attendanceMarkedAt: new Date(),
      },
    });
    const reviewRace = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        http(s1.token).post(`/bookings/me/${bookingId}/reviews`, {
          clarity: 5,
          punctuality: 4,
          preparation: 5 - (index % 2),
          feedback: `${XSS} race ${index}`,
        }),
      ),
    );
    assert.deepEqual(reviewRace.map((response) => response.status).sort(), [201, 409, 409, 409]);
    assert.equal(await db.review.count({ where: { bookingId } }), 1);
    const tutorRating = await db.tutorProfile.findUniqueOrThrow({ where: { userId: t1.id } });
    assert.equal(tutorRating.reviewCount, 1, 'rating cache counted once');
    pass(
      '4 concurrent bookings of one slot: one 201; 3 concurrent confirms: one 200 and one notice; 4 concurrent reviews: one 201 and count 1',
    );

    process.stdout.write('Authorization matrix and findings:\n');
    for (const line of matrix) {
      process.stdout.write(`  ${line}\n`);
    }
    process.stdout.write(`S3-T38 security regression: ${passed} checks passed.\n`);
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
        'S3-T38 security regression failed; discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}

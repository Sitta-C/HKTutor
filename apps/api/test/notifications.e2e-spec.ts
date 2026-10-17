import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { NotificationsController } from '@modules/notifications/notifications.controller';
import { NotificationsService } from '@modules/notifications/notifications.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const USER = '30000000-0000-4000-8000-000000000001';
const OTHER = '30000000-0000-4000-8000-000000000002';
const ID = '50000000-0000-4000-8000-000000000001';
const CREATED = new Date('2026-10-17T01:00:00.000Z');
const READ = new Date('2026-10-17T02:00:00.000Z');

describe('Notification APIs (HTTP, real guard/validation/service, mocked persistence)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const db = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    notification: { findMany: jest.fn(), count: jest.fn() },
    authSession: { findUnique: jest.fn() },
  };
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        JwtAuthGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    verifyAccessToken.mockReturnValue({ sub: USER, sid: 'synthetic-session' });
    db.authSession.findUnique.mockResolvedValue({
      userId: USER,
      revokedAt: null,
      expiresAt: new Date('2099-01-01'),
      user: {
        id: USER,
        email: 'synthetic@example.invalid',
        role: Role.STUDENT,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        emailVerifiedAt: CREATED,
      },
    });
    db.notification.findMany.mockResolvedValue([]);
    db.notification.count.mockResolvedValue(0);
    db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  });

  it.each(['get', 'patch', 'post'] as const)('requires a session for %s', async (method) => {
    const paths = {
      get: '/notifications',
      patch: `/notifications/${ID}/read`,
      post: '/notifications/read-all',
    };
    const response = await request(app.getHttpServer())
      [method](`/api/v1${paths[method]}`)
      .expect(401);
    const body: unknown = response.body;
    expect(body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token before touching notifications', async () => {
    verifyAccessToken.mockReturnValue(null);
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .auth('invalid', { type: 'bearer' })
      .expect(401);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns only public inbox fields and maps database dates to UTC', async () => {
    db.notification.findMany.mockResolvedValue([
      {
        id: ID,
        eventType: 'BOOKING_CONFIRMED',
        title: 'Booking confirmed',
        bookingId: null,
        readAt: null,
        createdAt: CREATED,
      },
    ]);
    db.notification.count.mockResolvedValue(1);
    const response = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .auth('valid', { type: 'bearer' })
      .expect(200);
    const body: unknown = response.body;
    expect(body).toEqual({
      items: [
        {
          id: ID,
          eventType: 'BOOKING_CONFIRMED',
          title: 'Booking confirmed',
          bookingId: null,
          readAt: null,
          createdAt: CREATED.toISOString(),
        },
      ],
      nextCursor: null,
      unreadCount: 1,
    });
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER }, take: 21 }),
    );
  });

  it.each(['true', 'false'])('parses unreadOnly=%s explicitly', async (value) => {
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .query({ unreadOnly: value, limit: '5' })
      .auth('valid', { type: 'bearer' })
      .expect(200);
    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, ...(value === 'true' ? { readAt: null } : {}) },
        take: 6,
      }),
    );
  });

  it.each([
    'limit=0',
    'limit=51',
    'limit=1.5',
    'limit=abc',
    'limit=',
    'limit=-1',
    'limit=1e1',
    'limit=1&limit=2',
    'unreadOnly=1',
    'unreadOnly=False',
    'unreadOnly=',
    'unreadOnly=true&unreadOnly=false',
    'cursor=invalid',
    'cursor=' +
      Buffer.from(JSON.stringify({ createdAt: '-271821-04-20T00:00:00.000Z', id: ID })).toString(
        'base64url',
      ),
    'cursor=',
    'userId=' + OTHER,
  ])('rejects invalid/authority query %s before querying', async (query) => {
    await request(app.getHttpServer())
      .get(`/api/v1/notifications?${query}`)
      .auth('valid', { type: 'bearer' })
      .expect(400);
    expect(db.notification.findMany).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.TUTOR, Role.ADMIN])(
    'uses the JWT recipient for %s without granting access to other inboxes',
    async (role) => {
      db.authSession.findUnique.mockResolvedValue({
        userId: USER,
        revokedAt: null,
        expiresAt: new Date('2099-01-01'),
        user: {
          id: USER,
          role,
          email: 'synthetic@example.invalid',
          accountStatus: AccountStatus.ACTIVE,
          deletedAt: null,
          emailVerifiedAt: CREATED,
        },
      });
      await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .auth('valid', { type: 'bearer' })
        .expect(200);
      expect(db.notification.count).toHaveBeenCalledWith({ where: { userId: USER, readAt: null } });
    },
  );

  it('returns the first persisted read time on repeat PATCH', async () => {
    db.$queryRaw.mockResolvedValue([{ id: ID, readAt: READ }]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${ID}/read`)
        .auth('valid', { type: 'bearer' })
        .expect(200);
      const body: unknown = response.body;
      expect(body).toEqual({ id: ID, readAt: READ.toISOString() });
    }
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.objectContaining({ values: [ID, USER] }));
  });

  it.each([
    [1, 403],
    [0, 404],
  ])('returns the specified ownership/missing error (%s)', async (exists, status) => {
    db.$queryRaw.mockResolvedValue([]);
    db.notification.count.mockResolvedValue(exists);
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/notifications/${ID}/read`)
      .auth('valid', { type: 'bearer' })
      .expect(status);
    const body: unknown = response.body;
    expect(body).toMatchObject({
      statusCode: status,
      code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
    });
    expect(body).not.toHaveProperty('title');
    expect(body).not.toHaveProperty('userId');
  });

  it('rejects an invalid notification UUID', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/not-a-uuid/read')
      .auth('valid', { type: 'bearer' })
      .expect(400);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([`/notifications/${ID}/read`, '/notifications/read-all'])(
    'rejects extra body and query fields on %s',
    async (path) => {
      const method = path.endsWith('read-all') ? 'post' : 'patch';
      await request(app.getHttpServer())
        [method](`/api/v1${path}`)
        .auth('valid', { type: 'bearer' })
        .send({ userId: OTHER })
        .expect(400);
      await request(app.getHttpServer())
        [method](`/api/v1${path}?userId=${OTHER}`)
        .auth('valid', { type: 'bearer' })
        .expect(400);
      expect(db.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it.each([
    [4, READ],
    [0, null],
  ])('returns 200 for bulk read including an empty inbox (%s)', async (updatedCount, readAt) => {
    db.$queryRaw.mockResolvedValue([{ updatedCount, readAt }]);
    const response = await request(app.getHttpServer())
      .post('/api/v1/notifications/read-all')
      .auth('valid', { type: 'bearer' })
      .expect(200);
    const body: unknown = response.body;
    expect(body).toEqual({ updatedCount, readAt: readAt?.toISOString() ?? null });
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.objectContaining({ values: [USER] }));
  });

  it('registers all three paths with their response schemas in OpenAPI', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    const body: unknown = response.body;
    expect(body).toMatchObject({
      paths: {
        '/api/v1/notifications': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NotificationsResponseDto' },
                  },
                },
              },
            },
          },
        },
        '/api/v1/notifications/{notificationId}/read': {
          patch: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NotificationReadResponseDto' },
                  },
                },
              },
            },
          },
        },
        '/api/v1/notifications/read-all': {
          post: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/NotificationsReadAllResponseDto' },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});

import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { CouponsController } from '@modules/coupons/coupons.controller';
import { CouponsService } from '@modules/coupons/coupons.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const URL = '/api/v1/admin/coupons';
const ACTOR = '10000000-0000-4000-8000-000000000001';
const NOW = new Date('2030-01-01T00:00:00.000Z');
const BODY = { code: 'WELCOME10', percent: 10, maxUses: 1, expiresAt: '2031-01-01T00:00:00.000Z' };

describe('Admin coupons HTTP contract (real guards, validation and service; mocked database)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const session = jest.fn();
  const db = { coupon: { create: jest.fn(), findMany: jest.fn() }, $queryRaw: jest.fn() };
  const transaction = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CouponsController],
      providers: [
        CouponsService,
        JwtAuthGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: { authSession: { findUnique: session }, $transaction: transaction },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    authenticate();
    transaction.mockImplementation((run: (tx: typeof db) => Promise<unknown>) => run(db));
    db.coupon.create.mockImplementation(({ data }: { data: typeof BODY & { active: boolean } }) =>
      Promise.resolve({
        ...data,
        id: '60000000-0000-4000-8000-000000000001',
        createdAt: NOW,
        updatedAt: NOW,
        _count: { uses: 0, reservations: 0 },
      }),
    );
    db.coupon.findMany.mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['post', 'get'] as const)('requires authentication on %s', async (method) => {
    const response = await request(app.getHttpServer())[method](URL).send(BODY).expect(401);
    expect(response.body as unknown).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.TUTOR])('rejects %s before persistence', async (role) => {
    authenticate({ role });
    for (const method of ['post', 'get'] as const) {
      await request(app.getHttpServer())
        [method](URL)
        .auth('test', { type: 'bearer' })
        .send(BODY)
        .expect(403);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    { revokedAt: NOW },
    { expiresAt: new Date('2000-01-01T00:00:00Z') },
    { user: { emailVerifiedAt: null } },
    { user: { accountStatus: AccountStatus.SUSPENDED } },
    { user: { deletedAt: NOW } },
  ])('rejects an invalid session/account %p', async (override) => {
    const value = authenticate();
    session.mockResolvedValue({
      ...value,
      ...override,
      user: { ...value.user, ...override.user },
    });
    for (const method of ['post', 'get'] as const) {
      await request(app.getHttpServer())
        [method](URL)
        .auth('test', { type: 'bearer' })
        .send(BODY)
        .expect(401);
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([{ consentAcceptedAt: null }, { policyVersion: 'old-policy' }])(
    'requires current consent %p',
    async (fields) => {
      authenticate(fields);
      for (const method of ['post', 'get'] as const) {
        await request(app.getHttpServer())
          [method](URL)
          .auth('test', { type: 'bearer' })
          .send(BODY)
          .expect(403);
      }
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each([1, 100])(
    'creates %i percent with normalized code, safe metadata and no caching',
    async (percent) => {
      const response = await request(app.getHttpServer())
        .post(URL)
        .auth('test', { type: 'bearer' })
        .send({ ...BODY, code: ' \tWelcome10\n', percent })
        .expect(201)
        .expect('Cache-Control', 'no-store');
      expect(response.body as unknown).toEqual({
        ...BODY,
        code: 'WELCOME10',
        percent,
        active: true,
        id: '60000000-0000-4000-8000-000000000001',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        consumedUses: 0,
        reservedUses: 0,
        availableUses: 1,
      });
      expect(db.$queryRaw).toHaveBeenCalledWith(expect.anything(), ACTOR);
    },
  );

  it('preserves false and the maximum Postgres usage limit', async () => {
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...BODY, active: false, maxUses: 2147483647 })
      .expect(201);
    expect(response.body as unknown).toMatchObject({ active: false, maxUses: 2147483647 });
  });

  it.each([
    { percent: 0 },
    { percent: 120 },
    { percent: -10 },
    { percent: 1.5 },
    { percent: '10' },
    { percent: null },
    { maxUses: 0 },
    { maxUses: 2147483648 },
    { maxUses: 1.5 },
    { maxUses: '1' },
    { active: 'false' },
    { active: null },
    { code: 'AB' },
    { code: 'A'.repeat(33) },
    { code: 'ภาษาไทย' },
    { code: 'ßßß' },
    { code: 'A B' },
    { code: '' },
    { expiresAt: NOW.toISOString() },
    { expiresAt: '2029-12-31T23:59:59.999Z' },
    { expiresAt: '2031-01-01' },
    { expiresAt: '2031-02-30T00:00:00Z' },
    { expiresAt: 'invalid' },
    { expiresAt: '2031-01-01T07:00:00+07:00' },
    { expiresAt: '2031-01-01T00:00:00.0001Z' },
    { actorUserId: ACTOR },
    { consumedUses: 0 },
  ])('rejects invalid input %p without writing', async (fields) => {
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...BODY, ...fields })
      .expect(400);
    expect(response.body as unknown).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.coupon.create).not.toHaveBeenCalled();
  });

  it.each(['code', 'percent', 'maxUses', 'expiresAt'])('requires %s', async (field) => {
    const body: Record<string, unknown> = { ...BODY };
    delete body[field];
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([1, 50])('accepts list limit %i and returns a safe empty page', async (limit) => {
    const response = await request(app.getHttpServer())
      .get(URL)
      .auth('test', { type: 'bearer' })
      .query({ limit })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body as unknown).toEqual({ items: [], nextCursor: null });
    expect(db.coupon.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: limit + 1 }));
  });

  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: '1.5' },
    { limit: '' },
    { limit: ['1', '2'] },
    { limit: '0x10' },
    { limit: '1e1' },
    { cursor: '' },
    { cursor: 'a'.repeat(513) },
    { cursor: 'garbage' },
    { studentUserId: ACTOR },
  ])('rejects invalid query %p', async (query) => {
    await request(app.getHttpServer())
      .get(URL)
      .auth('test', { type: 'bearer' })
      .query(query)
      .expect(400);
    expect(db.coupon.findMany).not.toHaveBeenCalled();
  });

  function authenticate(
    fields: { role?: Role; consentAcceptedAt?: Date | null; policyVersion?: string } = {},
  ) {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: ACTOR });
    const value = {
      id: 'session-id',
      userId: ACTOR,
      expiresAt: new Date('2035-01-01T00:00:00Z'),
      revokedAt: null,
      user: {
        id: ACTOR,
        role: Role.ADMIN,
        email: 'admin@example.test',
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        emailVerifiedAt: NOW,
        consentAcceptedAt: NOW,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        ...fields,
      },
    };
    session.mockResolvedValue(value);
    return value;
  }
});

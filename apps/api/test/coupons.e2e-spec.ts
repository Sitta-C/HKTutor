import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { Prisma } from '@generated/prisma/client';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { CouponsController } from '@modules/coupons/coupons.controller';
import { CouponsService } from '@modules/coupons/coupons.service';
import { COUPON_CODE_EXISTS_EXAMPLE } from '@modules/coupons/coupons.swagger';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const URL = '/api/v1/admin/coupons';
const COUPON_ID = '60000000-0000-4000-8000-000000000001';
const ACTIVATION_URL = `${URL}/${COUPON_ID}/activation`;
const ACTOR = '10000000-0000-4000-8000-000000000001';
const NOW = new Date('2030-01-01T00:00:00.000Z');
const BODY = { code: 'WELCOME10', percent: 10, maxUses: 1, expiresAt: '2031-01-01T00:00:00.000Z' };
/** The only fields a coupon response may carry; audit and redemption internals stay private. */
const COUPON_RESPONSE_KEYS = [
  'active',
  'availableUses',
  'code',
  'consumedUses',
  'createdAt',
  'expiresAt',
  'id',
  'maxUses',
  'percent',
  'reservedUses',
  'updatedAt',
];

describe('Admin coupons HTTP contract (real guards, validation and service; mocked database)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const session = jest.fn();
  const db = {
    coupon: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };
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
    const coupon = {
      ...BODY,
      id: COUPON_ID,
      active: true,
      expiresAt: new Date(BODY.expiresAt),
      createdAt: NOW,
      updatedAt: NOW,
      _count: { uses: 0, reservations: 0 },
    };
    db.coupon.findUnique.mockResolvedValue(coupon);
    db.coupon.update.mockImplementation(({ data }: { data: { active: boolean } }) =>
      Promise.resolve({ ...coupon, active: data.active }),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['post', 'get'] as const)('requires authentication on %s', async (method) => {
    const response = await request(app.getHttpServer())[method](URL).send(BODY).expect(401);
    expect(response.body as unknown).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires authentication for activation', async () => {
    await request(app.getHttpServer()).patch(ACTIVATION_URL).send({ active: true }).expect(401);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.TUTOR])('rejects %s before persistence', async (role) => {
    authenticate({ role, consentAcceptedAt: null, policyVersion: null });
    for (const method of ['post', 'get'] as const) {
      await request(app.getHttpServer())
        [method](URL)
        .auth('test', { type: 'bearer' })
        .send(BODY)
        .expect(403);
    }
    await request(app.getHttpServer())
      .patch(ACTIVATION_URL)
      .auth('test', { type: 'bearer' })
      .send({ active: true })
      .expect(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([Role.STUDENT, Role.TUTOR])(
    'rejects forged admin identity from %s before body/query validation',
    async (role) => {
      authenticate({ role });
      for (const method of ['post', 'get'] as const) {
        const attempt = request(app.getHttpServer())[method](URL).auth('test', {
          type: 'bearer',
        });
        const response = await (
          method === 'post'
            ? attempt.send({ ...BODY, actorUserId: ACTOR, role: Role.ADMIN })
            : attempt.query({ actorUserId: ACTOR, role: Role.ADMIN })
        ).expect(403);
        expect(response.body as unknown).toMatchObject({ code: 'FORBIDDEN' });
      }
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects an expired or invalid access token before reading the session or persistence', async () => {
    verifyAccessToken.mockReturnValue(null);
    for (const method of ['post', 'get'] as const) {
      await request(app.getHttpServer())
        [method](URL)
        .auth('expired', { type: 'bearer' })
        .send(BODY)
        .expect(401);
    }
    expect(session).not.toHaveBeenCalled();
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
    await request(app.getHttpServer())
      .patch(ACTIVATION_URL)
      .auth('test', { type: 'bearer' })
      .send({ active: true })
      .expect(401);
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    { consentAcceptedAt: null, policyVersion: null },
    { consentAcceptedAt: null },
    { policyVersion: null },
    { policyVersion: 'old-policy' },
  ])('allows an admin to create and list without current consent %p', async (fields) => {
    authenticate(fields);
    await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(BODY)
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.anything(), ACTOR);
    await request(app.getHttpServer())
      .get(URL)
      .auth('test', { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await request(app.getHttpServer())
      .patch(ACTIVATION_URL)
      .auth('test', { type: 'bearer' })
      .send({ active: false })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(db.auditLog.create).toHaveBeenCalled();
    expect(db.coupon.create).toHaveBeenCalledTimes(1);
    expect(db.coupon.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { active: null },
    { active: 'true' },
    { active: 1 },
    { active: [] },
    { active: true, percent: 90 },
    { active: false, actorUserId: ACTOR },
  ])('rejects invalid activation body %p before writes', async (body) => {
    await request(app.getHttpServer())
      .patch(ACTIVATION_URL)
      .auth('test', { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('validates activation UUID and reports missing coupons', async () => {
    await request(app.getHttpServer())
      .patch(`${URL}/invalid/activation`)
      .auth('test', { type: 'bearer' })
      .send({ active: true })
      .expect(400);
    expect(transaction).not.toHaveBeenCalled();
    db.coupon.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .patch(ACTIVATION_URL)
      .auth('test', { type: 'bearer' })
      .send({ active: true })
      .expect(404);
    expect(db.coupon.update).not.toHaveBeenCalled();
  });

  it.each([true, false])('sets activation to %s using the authenticated actor', async (active) => {
    if (active) {
      db.coupon.findUnique.mockResolvedValue({
        ...BODY,
        id: COUPON_ID,
        active: false,
        expiresAt: new Date(BODY.expiresAt),
        createdAt: NOW,
        updatedAt: NOW,
        _count: { uses: 0, reservations: 0 },
      });
    }
    const response = await request(app.getHttpServer())
      .patch(ACTIVATION_URL)
      .auth('test', { type: 'bearer' })
      .send({ active })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body as unknown).toMatchObject({
      id: COUPON_ID,
      active,
      consumedUses: 0,
      reservedUses: 0,
      availableUses: 1,
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorUserId: ACTOR, afterData: { active } }) as unknown,
      }),
    );
  });

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

  it('returns the documented 409 envelope for a case-insensitive duplicate code', async () => {
    db.coupon.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: '7.10.0',
        code: 'P2002',
        meta: { target: ['code'] },
      }),
    );
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...BODY, code: 'welcome10' })
      .expect(409)
      .expect('Cache-Control', 'no-store');
    expect(response.body as unknown).toEqual(COUPON_CODE_EXISTS_EXAMPLE);
    expect(db.coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'WELCOME10' }) as unknown }),
    );
  });

  it('keeps audit and redemption internals out of create, list and activation responses', async () => {
    const created = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send(BODY)
      .expect(201);
    expect(Object.keys(created.body as object).sort()).toEqual(COUPON_RESPONSE_KEYS);

    db.coupon.findMany.mockResolvedValue([await db.coupon.findUnique()]);
    const listed = await request(app.getHttpServer())
      .get(URL)
      .auth('test', { type: 'bearer' })
      .expect(200);
    const page = listed.body as { items: object[]; nextCursor: string | null };
    expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor']);
    expect(page.items).toHaveLength(1);
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(COUPON_RESPONSE_KEYS);

    const activated = await request(app.getHttpServer())
      .patch(ACTIVATION_URL)
      .auth('test', { type: 'bearer' })
      .send({ active: false })
      .expect(200);
    expect(Object.keys(activated.body as object).sort()).toEqual(COUPON_RESPONSE_KEYS);
    for (const body of [created.body, listed.body, activated.body] as unknown[]) {
      expect(JSON.stringify(body)).not.toMatch(/actor|audit|operationKey|student|reservation/i);
    }
  });

  it('preserves false and the maximum Postgres usage limit', async () => {
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...BODY, active: false, maxUses: 2147483647 })
      .expect(201);
    expect(response.body as unknown).toMatchObject({ active: false, maxUses: 2147483647 });
  });

  it('accepts UTC expiry one millisecond in the future without rounding it', async () => {
    const expiresAt = new Date(NOW.getTime() + 1).toISOString();
    const response = await request(app.getHttpServer())
      .post(URL)
      .auth('test', { type: 'bearer' })
      .send({ ...BODY, expiresAt })
      .expect(201);
    expect(response.body as unknown).toMatchObject({ expiresAt });
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
    fields: { role?: Role; consentAcceptedAt?: Date | null; policyVersion?: string | null } = {},
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

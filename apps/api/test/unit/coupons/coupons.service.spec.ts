import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { decodeCouponCursor, encodeCouponCursor } from '@modules/coupons/coupons.cursor';
import { CouponsService } from '@modules/coupons/coupons.service';

const NOW = new Date('2030-01-01T00:00:00.000Z');
const ID = '60000000-0000-4000-8000-000000000001';
const ACTOR = '10000000-0000-4000-8000-000000000001';
const dto = {
  code: 'WELCOME10',
  percent: 10,
  maxUses: 10,
  expiresAt: '2031-01-01T00:00:00.000Z',
};
const row = {
  ...dto,
  id: ID,
  active: true,
  expiresAt: new Date(dto.expiresAt),
  createdAt: NOW,
  updatedAt: NOW,
  _count: { uses: 2, reservations: 3 },
};

describe('CouponsService', () => {
  let service: CouponsService;
  const db = {
    coupon: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const transaction = jest.fn();

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
    transaction.mockImplementation((run: (tx: typeof db) => Promise<unknown>) => run(db));
    db.coupon.create.mockResolvedValue({ ...row, _count: { uses: 0, reservations: 0 } });
    db.coupon.findMany.mockResolvedValue([row]);
    db.coupon.findUnique.mockResolvedValue(row);
    db.coupon.update.mockResolvedValue({ ...row, active: false });
    const module = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: PrismaService, useValue: { $transaction: transaction } },
      ],
    }).compile();
    service = module.get(CouponsService);
  });
  afterEach(() => jest.restoreAllMocks());

  it('binds the actor before inserting under the same transaction and defaults active', async () => {
    const result = await service.create(ACTOR, { ...dto, code: ' welcome10 ' });
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.anything(), ACTOR);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.coupon.create.mock.invocationCallOrder[0] ?? 0,
    );
    expect(db.coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...dto, code: 'WELCOME10', active: true, expiresAt: row.expiresAt },
      }),
    );
    expect(result).toEqual({
      ...dto,
      id: ID,
      active: true,
      consumedUses: 0,
      reservedUses: 0,
      availableUses: 10,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it.each([NOW.toISOString(), '2029-12-31T23:59:59.999Z', 'invalid'])(
    'rejects expiry %s without opening a transaction',
    async (expiresAt) => {
      await expect(service.create(ACTOR, { ...dto, expiresAt })).rejects.toMatchObject({
        status: 400,
      });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('checks expiry again after waiting for a transaction connection', async () => {
    db.$queryRaw.mockImplementation(() => {
      jest.spyOn(Date, 'now').mockReturnValue(new Date(dto.expiresAt).getTime());
      return Promise.resolve([]);
    });
    await expect(service.create(ACTOR, dto)).rejects.toMatchObject({ status: 400 });
    expect(db.coupon.create).not.toHaveBeenCalled();
  });

  it('maps a database code collision to the domain conflict', async () => {
    db.coupon.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        clientVersion: '7.10.0',
        code: 'P2002',
        meta: { target: ['code'] },
      }),
    );
    await expect(service.create(ACTOR, dto)).rejects.toMatchObject({
      response: { code: 'COUPON_CODE_EXISTS' },
      status: 409,
    });
  });

  it('does not disguise an audit failure as a duplicate code', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError('audit unique failure', {
      clientVersion: '7.10.0',
      code: 'P2002',
      meta: { target: ['operationKey'] },
    });
    db.coupon.create.mockRejectedValue(failure);
    await expect(service.create(ACTOR, dto)).rejects.toBe(failure);
  });

  it.each([
    ['Coupon_code_key', true],
    ['AuditLog_operationKey_key', false],
  ])('handles the PostgreSQL adapter index %s specifically', async (index, conflict) => {
    const failure = new Prisma.PrismaClientKnownRequestError('unique failure', {
      clientVersion: '7.10.0',
      code: 'P2002',
      meta: { driverAdapterError: { cause: { constraint: { index } } } },
    });
    db.coupon.create.mockRejectedValue(failure);
    const outcome = service.create(ACTOR, dto);
    if (conflict) {
      await expect(outcome).rejects.toMatchObject({
        response: { code: 'COUPON_CODE_EXISTS' },
        status: 409,
      });
    } else {
      await expect(outcome).rejects.toBe(failure);
    }
  });

  it('changes only activation and atomically binds minimal audit evidence to the actor', async () => {
    const result = await service.setActivation(ACTOR, ID, false);
    expect(db.coupon.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID }, data: { active: false } }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String) as unknown,
        actorUserId: ACTOR,
        action: 'coupon.active_change',
        entityType: 'Coupon',
        entityId: ID,
        beforeData: { active: true },
        afterData: { active: false },
        operationKey: expect.stringMatching(/^coupon\.active_change:/) as unknown,
      },
      select: { id: true },
    });
    expect(result).toMatchObject({
      active: false,
      consumedUses: 2,
      reservedUses: 3,
      availableUses: 5,
      percent: 10,
    });
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.coupon.update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('returns the existing state on retries without updating or writing another audit', async () => {
    await service.setActivation(ACTOR, ID, true);
    expect(db.coupon.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing coupon without writes', async () => {
    db.coupon.findUnique.mockResolvedValue(null);
    await expect(service.setActivation(ACTOR, ID, false)).rejects.toMatchObject({ status: 404 });
    expect(db.coupon.update).not.toHaveBeenCalled();
  });

  it('propagates an activation audit failure so the transaction rolls back', async () => {
    const failure = new Error('audit unavailable');
    db.auditLog.create.mockRejectedValue(failure);
    await expect(service.setActivation(ACTOR, ID, false)).rejects.toBe(failure);
  });

  it('returns only safe metadata and counts from a repeatable-read snapshot', async () => {
    const result = await service.list({});
    expect(result.items[0]).toEqual({
      ...dto,
      id: ID,
      active: true,
      consumedUses: 2,
      reservedUses: 3,
      availableUses: 5,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(db.coupon.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: expect.objectContaining({
          _count: {
            select: {
              uses: true,
              reservations: { where: { status: 'RESERVED' } },
            },
          },
        }) as unknown,
      }),
    );
    expect(result.nextCursor).toBeNull();
  });

  it('uses the last returned row as an exclusive equal-time boundary', async () => {
    db.coupon.findMany.mockResolvedValue([
      row,
      { ...row, id: '60000000-0000-4000-8000-000000000000' },
    ]);
    const page = await service.list({ limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(encodeCouponCursor({ id: ID, createdAt: NOW.toISOString() }));
    await service.list({ limit: 1, cursor: page.nextCursor ?? '' });
    expect(db.coupon.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ createdAt: { lt: NOW } }, { createdAt: NOW, id: { lt: ID } }],
        },
      }),
    );
    db.coupon.findMany.mockResolvedValue([]);
    expect(await service.list({})).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    'garbage',
    '',
    'a'.repeat(513),
    Buffer.from(JSON.stringify({ id: ID, createdAt: '2030-02-30' })).toString('base64url'),
  ])('rejects malformed cursor %s', (cursor) => {
    expect(() => decodeCouponCursor(cursor)).toThrow('Invalid coupon list cursor');
  });
});

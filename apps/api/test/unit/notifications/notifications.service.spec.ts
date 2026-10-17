import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
} from '@modules/notifications/notifications.cursor';
import { NotificationsService } from '@modules/notifications/notifications.service';

const USER = '30000000-0000-4000-8000-000000000001';
const ID = '50000000-0000-4000-8000-000000000001';
const CREATED = new Date('2026-10-17T01:00:00.000Z');
const READ = new Date('2026-10-17T02:00:00.000Z');
const stored = {
  bookingId: null,
  createdAt: CREATED,
  eventType: 'BOOKING_CREATED',
  id: ID,
  readAt: null,
  title: 'New booking request',
};

describe('NotificationsService', () => {
  const db = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    notification: { findMany: jest.fn(), count: jest.fn() },
  };
  let service: NotificationsService;
  beforeEach(async () => {
    jest.resetAllMocks();
    db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
    db.notification.findMany.mockResolvedValue([]);
    db.notification.count.mockResolvedValue(0);
    const moduleRef = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: db }],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('limits the page, retains a timestamp tie boundary and counts all own unread rows in one snapshot', async () => {
    db.notification.findMany.mockResolvedValue([
      { ...stored, id: '50000000-0000-4000-8000-000000000003' },
      { ...stored, id: '50000000-0000-4000-8000-000000000002' },
      stored,
    ]);
    db.notification.count.mockResolvedValue(7);
    const result = await service.list(USER, { limit: 2 });
    expect(result.items.map((row) => row.id)).toEqual([
      '50000000-0000-4000-8000-000000000003',
      '50000000-0000-4000-8000-000000000002',
    ]);
    expect(result.unreadCount).toBe(7);
    expect(result.nextCursor).not.toBeNull();
    expect(decodeNotificationCursor(result.nextCursor ?? '')).toEqual({
      createdAt: CREATED.toISOString(),
      id: result.items[1]?.id,
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(db.notification.count).toHaveBeenCalledWith({ where: { userId: USER, readAt: null } });
    expect(result.items[0]).not.toHaveProperty('userId');
    expect(result.items[0]).not.toHaveProperty('eventKey');
    expect(result.items[0]?.createdAt).toBe(CREATED.toISOString());
  });

  it('keeps recipient and unread filters when applying both cursor columns', async () => {
    const cursor = encodeNotificationCursor({ createdAt: CREATED.toISOString(), id: ID });
    await service.list(USER, { cursor, unreadOnly: true, limit: 5 });
    expect(db.notification.findMany).toHaveBeenCalledWith({
      where: {
        userId: USER,
        readAt: null,
        OR: [{ createdAt: { lt: CREATED } }, { createdAt: CREATED, id: { lt: ID } }],
      },
      select: {
        bookingId: true,
        createdAt: true,
        eventType: true,
        id: true,
        readAt: true,
        title: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 6,
    });
  });

  it('returns no next cursor on empty and exact-sized last pages', async () => {
    expect(await service.list(USER, {})).toEqual({ items: [], nextCursor: null, unreadCount: 0 });
    db.notification.findMany.mockResolvedValue([stored]);
    const page = await service.list(USER, { limit: 1, unreadOnly: false });
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(1);
  });

  it('rejects a malformed cursor before accessing persistence', async () => {
    await expect(service.list(USER, { cursor: 'invalid' })).rejects.toThrow(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns the database receipt for an atomic read and binds both owner and notification ID', async () => {
    db.$queryRaw.mockResolvedValue([{ id: ID, readAt: READ }]);
    expect(await service.markRead(USER, ID)).toEqual({ id: ID, readAt: READ.toISOString() });
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.objectContaining({ values: [ID, USER] }));
    expect(db.notification.count).not.toHaveBeenCalled();
  });

  it.each([
    [1, ForbiddenException],
    [0, NotFoundException],
  ])(
    'distinguishes an inaccessible/missing ID without loading foreign content (%s)',
    async (exists, error) => {
      db.$queryRaw.mockResolvedValue([]);
      db.notification.count.mockResolvedValue(exists);
      await expect(service.markRead(USER, ID)).rejects.toThrow(error);
      expect(db.notification.count).toHaveBeenCalledWith({ where: { id: ID } });
      expect(db.notification.findMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    [3, READ],
    [0, null],
  ])('returns the count and receipt for bulk read (%s)', async (updatedCount, readAt) => {
    db.$queryRaw.mockResolvedValue([{ updatedCount, readAt }]);
    expect(await service.markAllRead(USER)).toEqual({
      updatedCount,
      readAt: readAt?.toISOString() ?? null,
    });
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.objectContaining({ values: [USER] }));
  });

  it('propagates persistence failures instead of claiming a successful write', async () => {
    const failure = new Error('Database unavailable');
    db.$queryRaw.mockRejectedValue(failure);
    await expect(service.markRead(USER, ID)).rejects.toBe(failure);
    await expect(service.markAllRead(USER)).rejects.toBe(failure);
  });
});

describe('notification cursor validation', () => {
  it('roundtrips a complete boundary', () => {
    const boundary = { createdAt: CREATED.toISOString(), id: ID };
    expect(decodeNotificationCursor(encodeNotificationCursor(boundary))).toEqual(boundary);
  });
  it.each([
    '',
    '!',
    'a'.repeat(513),
    'invalid',
    ...[
      null,
      [],
      { id: ID },
      { createdAt: 'bad', id: ID },
      { createdAt: CREATED.toISOString(), id: 'bad' },
      { createdAt: CREATED.toISOString(), id: ID, userId: USER },
      { createdAt: '2026-10-17', id: ID },
      { createdAt: '-271821-04-20T00:00:00.000Z', id: ID },
      { createdAt: '+275760-09-13T00:00:00.000Z', id: ID },
      { createdAt: '0000-01-01T00:00:00.000Z', id: ID },
    ].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')),
    encodeNotificationCursor({ createdAt: CREATED.toISOString(), id: ID }) + '=',
  ])('rejects malformed/noncanonical cursor %#', (cursor) => {
    expect(() => decodeNotificationCursor(cursor)).toThrow(BadRequestException);
  });
});

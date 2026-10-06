import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { AvatarRecoveryService } from '@modules/avatars/avatar-recovery.service';

import type { TestingModule } from '@nestjs/testing';

describe('AvatarRecoveryService', () => {
  const path = '20000000-0000-4000-8000-000000000001/orphan.webp';
  const db = {
    $queryRaw: jest.fn(),
    user: { findUnique: jest.fn() },
    avatarUploadIntent: { delete: jest.fn(), updateMany: jest.fn() },
  };
  const transaction = jest.fn();
  const storage = { remove: jest.fn() };
  let module: TestingModule;
  let service: AvatarRecoveryService;
  let loggerError: jest.SpyInstance;

  beforeEach(async () => {
    jest.resetAllMocks();
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    db.$queryRaw.mockResolvedValue([{ objectPath: path }]);
    db.user.findUnique.mockResolvedValue(null);
    transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
    );
    module = await Test.createTestingModule({
      providers: [
        AvatarRecoveryService,
        {
          provide: PrismaService,
          useValue: { ...db, $transaction: transaction, avatarUploadIntent: db.avatarUploadIntent },
        },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(AvatarRecoveryService);
  });

  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  it('deletes an unreferenced file before removing its intent', async () => {
    await expect(service.cleanup()).resolves.toBe('cleaned');
    expect(storage.remove).toHaveBeenCalledWith('avatar', path);
    expect(db.avatarUploadIntent.delete).toHaveBeenCalledWith({ where: { objectPath: path } });
    expect(storage.remove.mock.invocationCallOrder[0]).toBeLessThan(
      db.avatarUploadIntent.delete.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('protects a referenced image after an ambiguous metadata commit', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'owner' });
    await expect(service.cleanup()).resolves.toBe('cleaned');
    expect(storage.remove).not.toHaveBeenCalled();
    expect(db.avatarUploadIntent.delete).toHaveBeenCalled();
  });

  it('retains failed cleanup and schedules a bounded retry without logging provider details', async () => {
    storage.remove.mockRejectedValue(new Error('secret-token private-bucket-path'));
    await expect(service.cleanup()).resolves.toBe('failed');
    expect(db.avatarUploadIntent.delete).not.toHaveBeenCalled();
    expect(db.avatarUploadIntent.updateMany).toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith('Avatar cleanup failed; durable intent retained');
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain('secret-token');
  });

  it('stops a batch when no due intent can be claimed', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await service.recoverPending();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('bounds each recovery run to five objects', async () => {
    await service.recoverPending();
    expect(transaction).toHaveBeenCalledTimes(5);
  });
});

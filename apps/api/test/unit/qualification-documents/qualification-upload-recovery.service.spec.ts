import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { QualificationUploadRecoveryService } from '@modules/qualification-documents/qualification-upload-recovery.service';

const PATH = '20000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001.pdf';

describe('QualificationUploadRecoveryService', () => {
  const query = jest.fn(() => Promise.resolve([{ objectPath: PATH }]));
  const reference = jest.fn<Promise<{ id: string } | null>, []>(() => Promise.resolve(null));
  const remove = jest.fn(() => Promise.resolve());
  const deleteIntent = jest.fn(() => Promise.resolve({ objectPath: PATH }));
  const retry = jest.fn(() => Promise.resolve({ count: 1 }));
  const tx = {
    $queryRaw: query,
    tutorDocument: { findUnique: reference },
    qualificationUploadIntent: { delete: deleteIntent },
  };
  const transaction = jest.fn(async <T>(work: (client: typeof tx) => Promise<T>): Promise<T> =>
    work(tx),
  );
  let service: QualificationUploadRecoveryService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        QualificationUploadRecoveryService,
        {
          provide: PrismaService,
          useValue: { $transaction: transaction, qualificationUploadIntent: { updateMany: retry } },
        },
        { provide: StorageService, useValue: { remove } },
      ],
    }).compile();
    service = module.get(QualificationUploadRecoveryService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue([{ objectPath: PATH }]);
    reference.mockResolvedValue(null);
    remove.mockResolvedValue();
    retry.mockResolvedValue({ count: 1 });
  });

  it('deletes only unreferenced objects and consumes the locked intent', async () => {
    await expect(service.cleanup(PATH)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith('document', PATH);
    expect(deleteIntent).toHaveBeenCalledWith({ where: { objectPath: PATH } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 25000 });
  });

  it('never removes a referenced object, including ambiguous metadata commits', async () => {
    reference.mockResolvedValue({ id: 'document-id' });
    await service.cleanup(PATH);
    expect(remove).not.toHaveBeenCalled();
    expect(deleteIntent).toHaveBeenCalled();
  });

  it('does not delete anything when the intent is gone or another worker owns its lock', async () => {
    query.mockResolvedValue([]);
    await expect(service.cleanup(PATH)).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(deleteIntent).not.toHaveBeenCalled();
  });

  it('retains failed deletions and schedules a durable retry without logging paths or errors', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    remove.mockRejectedValueOnce(new Error('provider-secret'));
    try {
      await service.cleanup(PATH);
      expect(deleteIntent).not.toHaveBeenCalled();
      const retryAt: unknown = expect.any(Date);
      expect(retry).toHaveBeenCalledWith({
        where: { objectPath: PATH },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: retryAt,
        },
      });
      expect(log).toHaveBeenCalledWith(
        'Qualification upload cleanup failed; persisted intent will retry',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('handles a unavailable database without dropping persisted work', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    transaction.mockRejectedValueOnce(new Error('unavailable'));
    try {
      await expect(service.recoverPending()).resolves.toBeUndefined();
      expect(remove).not.toHaveBeenCalled();
      expect(deleteIntent).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('stops the scheduled worker when its module closes', () => {
    jest.useFakeTimers();
    const recover = jest.spyOn(service, 'recoverPending').mockResolvedValue();
    try {
      service.onModuleInit();
      jest.advanceTimersByTime(60000);
      expect(recover).toHaveBeenCalledTimes(1);
      service.onModuleDestroy();
      jest.advanceTimersByTime(60000);
      expect(recover).toHaveBeenCalledTimes(1);
    } finally {
      recover.mockRestore();
      jest.useRealTimers();
    }
  });
});

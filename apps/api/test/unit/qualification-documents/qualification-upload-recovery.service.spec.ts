import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageRequestError } from '@infrastructure/storage/storage-request-error';
import { StorageService } from '@infrastructure/storage/storage.service';
import { QualificationUploadRecoveryService } from '@modules/qualification-documents/qualification-upload-recovery.service';

const PATH = '20000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001.pdf';
const PRIVATE_DETAILS = `sb_secret_private ${PATH} ?token=private`;

function databaseError(code = 'P2028', sqlState?: string): Error {
  return new Prisma.PrismaClientKnownRequestError(PRIVATE_DETAILS, {
    code,
    clientVersion: '7.10.0',
    meta: { code: sqlState, message: PRIVATE_DETAILS },
  });
}

describe('QualificationUploadRecoveryService', () => {
  const query = jest.fn(() => Promise.resolve([{ objectPath: PATH }]));
  const reference = jest.fn<Promise<{ id: string } | null>, []>(() => Promise.resolve(null));
  const remove = jest.fn(() => Promise.resolve());
  const deleteIntent = jest.fn(() => Promise.resolve({ objectPath: PATH }));
  const retry = jest.fn(() => Promise.resolve({ count: 1 }));
  const dueIntent = jest.fn<Promise<{ objectPath: string } | null>, []>(() =>
    Promise.resolve({ objectPath: PATH }),
  );
  const tx = {
    $queryRaw: query,
    tutorDocument: { findUnique: reference },
    qualificationUploadIntent: { delete: deleteIntent },
  };
  const transaction = jest.fn(async <T>(work: (client: typeof tx) => Promise<T>): Promise<T> =>
    work(tx),
  );
  let service: QualificationUploadRecoveryService;
  let log: jest.SpyInstance;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        QualificationUploadRecoveryService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: transaction,
            qualificationUploadIntent: { findFirst: dueIntent, updateMany: retry },
          },
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
    dueIntent.mockResolvedValue({ objectPath: PATH });
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(JSON.stringify(log.mock.calls)).not.toContain(PATH);
    expect(JSON.stringify(log.mock.calls)).not.toContain('sb_secret_private');
    expect(JSON.stringify(log.mock.calls)).not.toContain('token=private');
    jest.restoreAllMocks();
  });

  it('deletes only unreferenced objects and consumes the locked intent', async () => {
    await expect(service.cleanup(PATH)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith('document', PATH);
    expect(deleteIntent).toHaveBeenCalledWith({ where: { objectPath: PATH } });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10000,
      timeout: 25000,
    });
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
    expect(log).not.toHaveBeenCalled();
  });

  it('retains failed deletions and schedules a durable retry without logging paths or errors', async () => {
    remove.mockRejectedValueOnce(
      new StorageRequestError('Stored file could not be deleted', {
        status: 403,
        message: PRIVATE_DETAILS,
      }),
    );
    await expect(service.cleanup(PATH)).resolves.toBe(true);
    expect(deleteIntent).not.toHaveBeenCalled();
    const retryAt: unknown = expect.any(Date);
    expect(retry).toHaveBeenCalledWith({
      where: { objectPath: PATH },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: retryAt,
      },
    });
    expect(log).toHaveBeenCalledWith({
      message: 'Qualification upload cleanup failed',
      stage: 'remove_object',
      code: 'STORAGE_HTTP_403',
    });
  });

  it('reports a transaction start failure once per worker tick, then recovers on a later tick', async () => {
    transaction.mockRejectedValueOnce(databaseError());
    await expect(service.recoverPending()).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({
      message: 'Qualification upload cleanup failed',
      stage: 'transaction_start',
      code: 'P2028',
    });
    query.mockResolvedValueOnce([]);
    await service.recoverPending();
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('does not open a transaction or contact Storage when there are no due intents', async () => {
    dueIntent.mockResolvedValueOnce(null);
    await service.recoverPending();
    expect(transaction).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    await service.recoverPending();
    expect(transaction).toHaveBeenCalled();
  });

  it('reports an unavailable due-queue probe and retries it on a later tick', async () => {
    dueIntent.mockRejectedValueOnce(databaseError('P1001'));
    await expect(service.recoverPending()).resolves.toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({
      message: 'Qualification upload recovery failed',
      stage: 'check_due_intents',
      code: 'P1001',
    });
    dueIntent.mockResolvedValueOnce(null);
    await service.recoverPending();
    expect(dueIntent).toHaveBeenCalledTimes(2);
  });

  it('recognizes a transaction acquisition timeout without logging its raw message', async () => {
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        `Transaction API error: Unable to start a transaction in the given time. ${PRIVATE_DETAILS}`,
        { code: 'P2028', clientVersion: '7.10.0' },
      ),
    );
    await service.recoverPending();
    expect(log).toHaveBeenCalledWith({
      message: 'Qualification upload cleanup failed',
      stage: 'transaction_start',
      code: 'P2028/START_TIMEOUT',
    });
    expect(remove).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('distinguishes a missing intent table from a Storage failure', async () => {
    query.mockRejectedValueOnce(databaseError('P2010', '42P01'));
    await expect(service.cleanup()).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith({
      message: 'Qualification upload cleanup failed',
      stage: 'claim_intent',
      code: 'P2010/42P01',
    });
    expect(remove).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(['check_reference', 'delete_intent', 'transaction_commit'])(
    'reports failures during %s and retains a durable retry',
    async (stage) => {
      if (stage === 'check_reference') {
        reference.mockRejectedValueOnce(databaseError());
      } else if (stage === 'delete_intent') {
        deleteIntent.mockRejectedValueOnce(databaseError());
      } else {
        transaction.mockImplementationOnce(async (work) => {
          await work(tx);
          throw databaseError();
        });
      }
      await service.cleanup(PATH);
      expect(log).toHaveBeenCalledWith({
        message: 'Qualification upload cleanup failed',
        stage,
        code: 'P2028',
      });
      expect(retry).toHaveBeenCalledTimes(1);
      if (stage === 'check_reference') {
        expect(remove).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps both failure diagnostics and stops the batch when retry scheduling fails', async () => {
    remove.mockRejectedValueOnce(new ServiceUnavailableException(PRIVATE_DETAILS));
    retry.mockRejectedValueOnce(databaseError('P1001'));
    await expect(service.recoverPending()).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteIntent).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([
      [
        {
          message: 'Qualification upload cleanup failed',
          stage: 'remove_object',
          code: 'HTTP_503',
        },
      ],
      [
        {
          message: 'Qualification upload retry scheduling failed',
          stage: 'schedule_retry',
          code: 'P1001',
        },
      ],
    ]);
    query.mockResolvedValueOnce([]);
    await service.recoverPending();
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does not emit arbitrary exception codes, messages, metadata or stacks', async () => {
    transaction.mockRejectedValueOnce(
      Object.assign(new Error(PRIVATE_DETAILS), {
        code: PRIVATE_DETAILS,
        meta: { code: PRIVATE_DETAILS },
      }),
    );
    await service.cleanup();
    expect(log).toHaveBeenCalledWith({
      message: 'Qualification upload cleanup failed',
      stage: 'transaction_start',
      code: 'UNKNOWN',
    });
    query.mockRejectedValueOnce(databaseError('P2010', PRIVATE_DETAILS));
    await service.cleanup();
    expect(log).toHaveBeenLastCalledWith({
      message: 'Qualification upload cleanup failed',
      stage: 'claim_intent',
      code: 'P2010',
    });
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

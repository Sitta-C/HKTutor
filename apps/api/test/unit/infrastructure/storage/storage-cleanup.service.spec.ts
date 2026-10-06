import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { Prisma, StorageObjectPurpose } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageCleanupService } from '@infrastructure/storage/storage-cleanup.service';
import { StorageRequestError } from '@infrastructure/storage/storage-request-error';
import { StorageService } from '@infrastructure/storage/storage.service';

const DOCUMENT_PATH =
  '20000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001.pdf';
const AVATAR_PATH =
  '20000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001.webp';
const DOCUMENT_TARGET = {
  purpose: StorageObjectPurpose.QUALIFICATION_DOCUMENT,
  objectPath: DOCUMENT_PATH,
};
const AVATAR_TARGET = { purpose: StorageObjectPurpose.AVATAR, objectPath: AVATAR_PATH };
const PRIVATE_DETAILS = `sb_secret_private ${DOCUMENT_PATH} ?token=private`;

function databaseError(code = 'P2028', sqlState?: string): Error {
  return new Prisma.PrismaClientKnownRequestError(PRIVATE_DETAILS, {
    code,
    clientVersion: '7.10.0',
    meta: { code: sqlState, message: PRIVATE_DETAILS },
  });
}

describe('StorageCleanupService', () => {
  const query = jest.fn(() => Promise.resolve([DOCUMENT_TARGET]));
  const documentReference = jest.fn<Promise<{ id: string } | null>, []>(() =>
    Promise.resolve(null),
  );
  const avatarReference = jest.fn<Promise<{ id: string } | null>, []>(() => Promise.resolve(null));
  const remove = jest.fn(() => Promise.resolve());
  const deleteIntent = jest.fn(() => Promise.resolve(DOCUMENT_TARGET));
  const retry = jest.fn(() => Promise.resolve({ count: 1 }));
  const tx = {
    $queryRaw: query,
    user: { findUnique: avatarReference },
    tutorDocument: { findUnique: documentReference },
    storageCleanupIntent: { delete: deleteIntent },
  };
  const transaction = jest.fn(async <T>(work: (client: typeof tx) => Promise<T>): Promise<T> =>
    work(tx),
  );
  let service: StorageCleanupService;
  let log: jest.SpyInstance;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StorageCleanupService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: transaction,
            storageCleanupIntent: { updateMany: retry },
          },
        },
        { provide: StorageService, useValue: { remove } },
      ],
    }).compile();
    service = module.get(StorageCleanupService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue([DOCUMENT_TARGET]);
    documentReference.mockResolvedValue(null);
    avatarReference.mockResolvedValue(null);
    remove.mockResolvedValue();
    retry.mockResolvedValue({ count: 1 });
    log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(JSON.stringify(log.mock.calls)).not.toContain(DOCUMENT_PATH);
    expect(JSON.stringify(log.mock.calls)).not.toContain('sb_secret_private');
    expect(JSON.stringify(log.mock.calls)).not.toContain('token=private');
    jest.restoreAllMocks();
  });

  it('deletes an unreferenced qualification object before consuming its composite intent', async () => {
    await expect(service.cleanup(DOCUMENT_TARGET)).resolves.toBe('cleaned');
    expect(documentReference).toHaveBeenCalledWith({
      where: { objectPath: DOCUMENT_PATH },
      select: { id: true },
    });
    expect(remove).toHaveBeenCalledWith('document', DOCUMENT_PATH);
    expect(deleteIntent).toHaveBeenCalledWith({
      where: { purpose_objectPath: DOCUMENT_TARGET },
    });
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
      deleteIntent.mock.invocationCallOrder[0] ?? 0,
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10000,
      timeout: 25000,
    });
  });

  it('dispatches avatar cleanup to the avatar bucket and User reference', async () => {
    query.mockResolvedValue([AVATAR_TARGET]);
    await expect(service.cleanup(AVATAR_TARGET)).resolves.toBe('cleaned');
    expect(avatarReference).toHaveBeenCalledWith({
      where: { avatarObjectPath: AVATAR_PATH },
      select: { id: true },
    });
    expect(documentReference).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('avatar', AVATAR_PATH);
    expect(deleteIntent).toHaveBeenCalledWith({
      where: { purpose_objectPath: AVATAR_TARGET },
    });
  });

  it.each([
    { target: DOCUMENT_TARGET, reference: documentReference },
    { target: AVATAR_TARGET, reference: avatarReference },
  ])(
    'preserves referenced $target.purpose objects after ambiguous commits',
    async ({ target, reference }) => {
      query.mockResolvedValue([target]);
      reference.mockResolvedValue({ id: 'reference-id' });
      await expect(service.cleanup(target)).resolves.toBe('cleaned');
      expect(remove).not.toHaveBeenCalled();
      expect(deleteIntent).toHaveBeenCalled();
    },
  );

  it('does nothing when an intent is gone or another worker owns its lock', async () => {
    query.mockResolvedValue([]);
    await expect(service.cleanup(DOCUMENT_TARGET)).resolves.toBe('empty');
    expect(remove).not.toHaveBeenCalled();
    expect(deleteIntent).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('retains failed deletion with its purpose and schedules a sanitized retry', async () => {
    remove.mockRejectedValueOnce(
      new StorageRequestError('Stored file could not be deleted', {
        status: 403,
        message: PRIVATE_DETAILS,
      }),
    );
    await expect(service.cleanup(DOCUMENT_TARGET)).resolves.toBe('failed');
    expect(deleteIntent).not.toHaveBeenCalled();
    const retryAt: unknown = expect.any(Date);
    expect(retry).toHaveBeenCalledWith({
      where: DOCUMENT_TARGET,
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: retryAt,
      },
    });
    expect(log).toHaveBeenCalledWith({
      message: 'Storage cleanup failed',
      stage: 'remove_object',
      code: 'STORAGE_HTTP_403',
    });
  });

  it('recognizes transaction acquisition timeouts without exposing details', async () => {
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        `Transaction API error: Unable to start a transaction in the given time. ${PRIVATE_DETAILS}`,
        { code: 'P2028', clientVersion: '7.10.0' },
      ),
    );
    await expect(service.recoverPending()).resolves.toEqual({ processed: 0, failed: true });
    expect(log).toHaveBeenCalledWith({
      message: 'Storage cleanup failed',
      stage: 'transaction_start',
      code: 'P2028/START_TIMEOUT',
    });
    expect(remove).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('distinguishes a missing central intent table from a Storage failure', async () => {
    query.mockRejectedValueOnce(databaseError('P2010', '42P01'));
    await expect(service.cleanup()).resolves.toBe('failed');
    expect(log).toHaveBeenCalledWith({
      message: 'Storage cleanup failed',
      stage: 'claim_intent',
      code: 'P2010/42P01',
    });
    expect(remove).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it.each(['check_reference', 'delete_intent', 'transaction_commit'])(
    'retains an intent after a %s failure',
    async (stage) => {
      if (stage === 'check_reference') {
        documentReference.mockRejectedValueOnce(databaseError());
      } else if (stage === 'delete_intent') {
        deleteIntent.mockRejectedValueOnce(databaseError());
      } else {
        transaction.mockImplementationOnce(async (work) => {
          await work(tx);
          throw databaseError();
        });
      }
      await expect(service.cleanup(DOCUMENT_TARGET)).resolves.toBe('failed');
      expect(log).toHaveBeenCalledWith({
        message: 'Storage cleanup failed',
        stage,
        code: 'P2028',
      });
      expect(retry).toHaveBeenCalledTimes(1);
      if (stage === 'check_reference') {
        expect(remove).not.toHaveBeenCalled();
      }
    },
  );

  it('keeps both failure diagnostics when retry scheduling also fails', async () => {
    remove.mockRejectedValueOnce(new ServiceUnavailableException(PRIVATE_DETAILS));
    retry.mockRejectedValueOnce(databaseError('P1001'));
    await expect(service.recoverPending()).resolves.toEqual({ processed: 0, failed: true });
    expect(log.mock.calls).toEqual([
      [{ message: 'Storage cleanup failed', stage: 'remove_object', code: 'HTTP_503' }],
      [
        {
          message: 'Storage cleanup retry scheduling failed',
          stage: 'schedule_retry',
          code: 'P1001',
        },
      ],
    ]);
  });

  it('bounds each explicit recovery run to five objects', async () => {
    await expect(service.recoverPending()).resolves.toEqual({ processed: 5, failed: false });
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('stops a recovery batch when no due intent can be claimed', async () => {
    query.mockResolvedValue([]);
    await expect(service.recoverPending()).resolves.toEqual({ processed: 0, failed: false });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not poll the database or Storage after Nest module initialization', async () => {
    jest.useFakeTimers();
    const module = await Test.createTestingModule({
      providers: [{ provide: StorageCleanupService, useValue: service }],
    }).compile();
    try {
      await module.init();
      await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(transaction).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      await module.close();
      jest.useRealTimers();
    }
  });
});

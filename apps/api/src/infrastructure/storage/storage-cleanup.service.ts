import { HttpException, Injectable, Logger } from '@nestjs/common';

import { Prisma, StorageObjectPurpose } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageRequestError } from '@infrastructure/storage/storage-request-error';
import { StorageService } from '@infrastructure/storage/storage.service';

import type { StoragePurpose } from '@infrastructure/storage/storage.types';

export const STORAGE_CLEANUP_GRACE_MS = 5 * 60 * 1000;
const CLEANUP_RETRY_DELAY_MS = 60 * 1000;
const RECOVERY_TRANSACTION_MAX_WAIT_MS = 10 * 1000;

type CleanupResult = 'cleaned' | 'empty' | 'failed';
type CleanupTarget = { purpose: StorageObjectPurpose; objectPath: string };
type RecoveryStage =
  | 'transaction_start'
  | 'claim_intent'
  | 'check_reference'
  | 'remove_object'
  | 'delete_intent'
  | 'transaction_commit'
  | 'schedule_retry';

const SQL_STATES = new Set([
  '08001',
  '08003',
  '08006',
  '23503',
  '23505',
  '23514',
  '25006',
  '40001',
  '40P01',
  '42501',
  '42703',
  '42P01',
  '53300',
  '57014',
]);

function recoveryErrorCode(error: unknown): string {
  if (error instanceof StorageRequestError) {
    return error.failureCode;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code)) {
    if (
      error.code === 'P2028' &&
      error.message.includes('Unable to start a transaction in the given time.')
    ) {
      return 'P2028/START_TIMEOUT';
    }
    const sqlState: unknown = error.meta?.['code'];
    return typeof sqlState === 'string' && SQL_STATES.has(sqlState)
      ? `${error.code}/${sqlState}`
      : error.code;
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError &&
    error.errorCode &&
    /^P\d{4}$/.test(error.errorCode)
  ) {
    return error.errorCode;
  }
  if (error instanceof HttpException) {
    return `HTTP_${error.getStatus()}`;
  }
  return 'UNKNOWN';
}

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);
  private activeRun: Promise<{ processed: number; failed: boolean }> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Explicit entry point for operators or a future scheduler; API startup does not poll the queue.
  recoverPending(): Promise<{ processed: number; failed: boolean }> {
    if (!this.activeRun) {
      this.activeRun = this.runBatch().finally(() => {
        this.activeRun = null;
      });
    }
    return this.activeRun;
  }

  private async runBatch(): Promise<{ processed: number; failed: boolean }> {
    let processed = 0;
    for (let index = 0; index < 5; index += 1) {
      const result = await this.cleanup();
      if (result === 'failed') {
        return { processed, failed: true };
      }
      if (result === 'empty') {
        break;
      }
      processed += 1;
    }
    return { processed, failed: false };
  }

  async cleanup(target?: CleanupTarget): Promise<CleanupResult> {
    let claimed: CleanupTarget | undefined;
    let stage: RecoveryStage = 'transaction_start';
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          stage = 'claim_intent';
          const rows = target
            ? await tx.$queryRaw<CleanupTarget[]>`
              SELECT "purpose", "objectPath" FROM "StorageCleanupIntent"
              WHERE "purpose" = ${target.purpose}::"StorageObjectPurpose"
                AND "objectPath" = ${target.objectPath}
              FOR UPDATE SKIP LOCKED`
            : await tx.$queryRaw<CleanupTarget[]>`
              SELECT "purpose", "objectPath" FROM "StorageCleanupIntent"
              WHERE "nextAttemptAt" <= CURRENT_TIMESTAMP
              ORDER BY "nextAttemptAt", "purpose", "objectPath"
              LIMIT 1 FOR UPDATE SKIP LOCKED`;
          const intent = rows[0];
          if (!intent) {
            stage = 'transaction_commit';
            return 'empty';
          }
          claimed = intent;
          stage = 'check_reference';
          const referenced = await this.isReferenced(tx, intent);
          if (!referenced) {
            stage = 'remove_object';
            await this.storage.remove(this.storagePurpose(intent.purpose), intent.objectPath);
          }
          stage = 'delete_intent';
          await tx.storageCleanupIntent.delete({
            where: {
              purpose_objectPath: {
                purpose: intent.purpose,
                objectPath: intent.objectPath,
              },
            },
          });
          stage = 'transaction_commit';
          return 'cleaned';
        },
        { maxWait: RECOVERY_TRANSACTION_MAX_WAIT_MS, timeout: 25000 },
      );
    } catch (error) {
      this.logFailure('Storage cleanup failed', stage, error);
      if (claimed) {
        try {
          await this.prisma.storageCleanupIntent.updateMany({
            where: claimed,
            data: {
              attempts: { increment: 1 },
              nextAttemptAt: new Date(Date.now() + CLEANUP_RETRY_DELAY_MS),
            },
          });
        } catch (retryError) {
          this.logFailure('Storage cleanup retry scheduling failed', 'schedule_retry', retryError);
        }
      }
      return 'failed';
    }
  }

  private async isReferenced(
    tx: Prisma.TransactionClient,
    target: CleanupTarget,
  ): Promise<boolean> {
    if (target.purpose === StorageObjectPurpose.AVATAR) {
      return Boolean(
        await tx.user.findUnique({
          where: { avatarObjectPath: target.objectPath },
          select: { id: true },
        }),
      );
    }
    return Boolean(
      await tx.tutorDocument.findUnique({
        where: { objectPath: target.objectPath },
        select: { id: true },
      }),
    );
  }

  private storagePurpose(purpose: StorageObjectPurpose): StoragePurpose {
    return purpose === StorageObjectPurpose.AVATAR ? 'avatar' : 'document';
  }

  private logFailure(message: string, stage: RecoveryStage, error: unknown): void {
    // Never log raw errors, metadata, stacks, object paths, or provider response bodies.
    this.logger.error({ message, stage, code: recoveryErrorCode(error) });
  }
}

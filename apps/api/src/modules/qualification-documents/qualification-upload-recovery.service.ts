import { HttpException, Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageRequestError } from '@infrastructure/storage/storage-request-error';
import { StorageService } from '@infrastructure/storage/storage.service';

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

export const UPLOAD_RECOVERY_GRACE_MS = 5 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 60 * 1000;
const RECOVERY_TRANSACTION_MAX_WAIT_MS = 10 * 1000;

type RecoveryStage =
  | 'check_due_intents'
  | 'transaction_start'
  | 'claim_intent'
  | 'check_reference'
  | 'remove_object'
  | 'delete_intent'
  | 'transaction_commit'
  | 'schedule_retry'
  | 'worker';

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
export class QualificationUploadRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QualificationUploadRecoveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.recoverPending();
    }, RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async recoverPending(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    let stage: RecoveryStage = 'check_due_intents';
    try {
      // This is only an empty-queue probe; claiming and reference checks still happen under lock.
      const dueIntent = await this.prisma.qualificationUploadIntent.findFirst({
        where: { nextAttemptAt: { lte: new Date() } },
        select: { objectPath: true },
      });
      if (!dueIntent) {
        return;
      }
      stage = 'worker';
      for (let index = 0; index < 5; index += 1) {
        if (!(await this.cleanup())) {
          break;
        }
      }
    } catch (error) {
      this.logFailure('Qualification upload recovery failed', stage, error);
    } finally {
      this.running = false;
    }
  }

  async cleanup(objectPath?: string): Promise<boolean> {
    let claimedPath: string | undefined;
    let stage: RecoveryStage = 'transaction_start';
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Finalization locks the same intent: recovery cannot delete a committed document's file.
          stage = 'claim_intent';
          const rows = objectPath
            ? await tx.$queryRaw<Array<{ objectPath: string }>>`
              SELECT "objectPath" FROM "QualificationUploadIntent"
              WHERE "objectPath" = ${objectPath} FOR UPDATE SKIP LOCKED`
            : await tx.$queryRaw<Array<{ objectPath: string }>>`
              SELECT "objectPath" FROM "QualificationUploadIntent"
              WHERE "nextAttemptAt" <= CURRENT_TIMESTAMP
              ORDER BY "nextAttemptAt", "objectPath" LIMIT 1 FOR UPDATE SKIP LOCKED`;
          const intent = rows[0];
          if (!intent) {
            stage = 'transaction_commit';
            return false;
          }
          claimedPath = intent.objectPath;
          stage = 'check_reference';
          const reference = await tx.tutorDocument.findUnique({
            where: { objectPath: intent.objectPath },
            select: { id: true },
          });
          if (!reference) {
            stage = 'remove_object';
            await this.storage.remove('document', intent.objectPath);
          }
          stage = 'delete_intent';
          await tx.qualificationUploadIntent.delete({ where: { objectPath: intent.objectPath } });
          stage = 'transaction_commit';
          return true;
        },
        { maxWait: RECOVERY_TRANSACTION_MAX_WAIT_MS, timeout: 25000 },
      );
    } catch (error) {
      this.logFailure('Qualification upload cleanup failed', stage, error);
      if (claimedPath) {
        try {
          await this.prisma.qualificationUploadIntent.updateMany({
            where: { objectPath: claimedPath },
            data: {
              attempts: { increment: 1 },
              nextAttemptAt: new Date(Date.now() + RECOVERY_INTERVAL_MS),
            },
          });
        } catch (retryError) {
          // Stop this batch; remaining durable intents are retried on the next worker tick.
          this.logFailure(
            'Qualification upload retry scheduling failed',
            'schedule_retry',
            retryError,
          );
          return false;
        }
      }
      return claimedPath !== undefined;
    }
  }

  private logFailure(message: string, stage: RecoveryStage, error: unknown): void {
    // Never log raw errors, metadata, stacks, object paths, or provider response bodies.
    this.logger.error({ message, stage, code: recoveryErrorCode(error) });
  }
}

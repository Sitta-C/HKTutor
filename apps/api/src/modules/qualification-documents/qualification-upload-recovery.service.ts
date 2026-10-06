import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

export const UPLOAD_RECOVERY_GRACE_MS = 5 * 60 * 1000;
const RECOVERY_INTERVAL_MS = 60 * 1000;

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
    try {
      for (let index = 0; index < 5; index += 1) {
        if (!(await this.cleanup())) {
          break;
        }
      }
    } catch {
      this.logger.error(
        'Qualification upload recovery is unavailable; persisted intents will retry',
      );
    } finally {
      this.running = false;
    }
  }

  async cleanup(objectPath?: string): Promise<boolean> {
    let claimedPath: string | undefined;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Finalization locks the same intent: recovery cannot delete a committed document's file.
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
            return false;
          }
          claimedPath = intent.objectPath;
          const reference = await tx.tutorDocument.findUnique({
            where: { objectPath: intent.objectPath },
            select: { id: true },
          });
          if (!reference) {
            await this.storage.remove('document', intent.objectPath);
          }
          await tx.qualificationUploadIntent.delete({ where: { objectPath: intent.objectPath } });
          return true;
        },
        { timeout: 25000 },
      );
    } catch {
      if (claimedPath) {
        await this.prisma.qualificationUploadIntent.updateMany({
          where: { objectPath: claimedPath },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + RECOVERY_INTERVAL_MS),
          },
        });
      }
      this.logger.error('Qualification upload cleanup failed; persisted intent will retry');
      return claimedPath !== undefined;
    }
  }
}

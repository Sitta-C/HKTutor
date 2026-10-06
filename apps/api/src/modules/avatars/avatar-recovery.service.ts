import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageService } from '@infrastructure/storage/storage.service';

export const AVATAR_UPLOAD_GRACE_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;

@Injectable()
export class AvatarRecoveryService {
  private readonly logger = new Logger(AvatarRecoveryService.name);
  private activeRun: Promise<{ processed: number; failed: boolean }> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Also callable by an operator or the future centralized scheduler; no startup timer.
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
    try {
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
    } catch {
      this.logger.error('Avatar recovery failed; durable intents will retry');
      return { processed, failed: true };
    }
  }

  async cleanup(): Promise<'cleaned' | 'empty' | 'failed'> {
    let claimedPath: string | undefined;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Upload finalization takes this same lock before installing a new reference.
          const rows = await tx.$queryRaw<Array<{ objectPath: string }>>`
            SELECT "objectPath" FROM "AvatarUploadIntent"
            WHERE "nextAttemptAt" <= CURRENT_TIMESTAMP
            ORDER BY "nextAttemptAt", "objectPath" LIMIT 1 FOR UPDATE SKIP LOCKED`;
          const intent = rows[0];
          if (!intent) {
            return 'empty';
          }
          claimedPath = intent.objectPath;
          const reference = await tx.user.findUnique({
            where: { avatarObjectPath: intent.objectPath },
            select: { id: true },
          });
          if (!reference) {
            await this.storage.remove('avatar', intent.objectPath);
          }
          await tx.avatarUploadIntent.delete({ where: { objectPath: intent.objectPath } });
          return 'cleaned';
        },
        { maxWait: 10000, timeout: 25000 },
      );
    } catch {
      this.logger.error('Avatar cleanup failed; durable intent retained');
      if (claimedPath) {
        try {
          await this.prisma.avatarUploadIntent.updateMany({
            where: { objectPath: claimedPath },
            data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + RETRY_MS) },
          });
        } catch {
          this.logger.error('Avatar cleanup retry scheduling failed');
        }
      }
      return 'failed';
    }
  }
}

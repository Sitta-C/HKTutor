import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '@app/app.module';
import { StorageCleanupService } from '@infrastructure/storage/storage-cleanup.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(StorageCleanupService).recoverPending();
    Logger.overrideLogger(['error', 'warn', 'log']);
    new Logger('StorageCleanup').log({ message: 'Storage cleanup batch finished', ...result });
    if (result.failed) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  new Logger('StorageCleanup').error('Storage cleanup could not start');
  process.exitCode = 1;
});

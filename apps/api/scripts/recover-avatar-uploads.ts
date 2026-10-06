import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '@app/app.module';
import { AvatarRecoveryService } from '@modules/avatars/avatar-recovery.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(AvatarRecoveryService).recoverPending();
    Logger.overrideLogger(['error', 'warn', 'log']);
    new Logger('AvatarRecovery').log({ message: 'Avatar recovery batch finished', ...result });
    if (result.failed) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  new Logger('AvatarRecovery').error('Avatar recovery could not start');
  process.exitCode = 1;
});

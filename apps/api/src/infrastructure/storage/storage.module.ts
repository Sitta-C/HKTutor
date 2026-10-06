import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

import { StorageConfigService } from '@config/storage.config';
import { StorageService } from '@infrastructure/storage/storage.service';
import { STORAGE_CLIENT } from '@infrastructure/storage/storage.types';

import type { StorageClient } from '@infrastructure/storage/storage.types';

@Module({
  imports: [ConfigModule],
  providers: [
    StorageConfigService,
    {
      provide: STORAGE_CLIENT,
      inject: [StorageConfigService],
      useFactory: (config: StorageConfigService): StorageClient =>
        createClient<Record<string, never>>(config.values.url, config.values.secretKey, {
          auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
          global: {
            fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
          },
        }),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}

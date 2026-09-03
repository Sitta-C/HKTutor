// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ClerkClientProvider } from './clerk-client.provider';
import { ClerkAuthGuard } from './auth.guard';

@Module({
  providers: [ClerkClientProvider, ClerkAuthGuard],
  exports: [ClerkClientProvider, ClerkAuthGuard],
})
export class AuthModule {}

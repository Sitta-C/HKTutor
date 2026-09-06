// src/auth/auth.module.ts
import { createClerkClient } from '@clerk/backend';
import { Module, Global } from '@nestjs/common';

import { ClerkAuthGuard } from '@/auth/auth.guard';

@Global()
@Module({
  providers: [
    {
      provide: 'CLERK_CLIENT',
      useFactory: () => {
        if (!process.env['CLERK_SECRET_KEY']) {
          throw new Error('Secret key missing');
        }
        if (!process.env['CLERK_PUBLISHABLE_KEY']) {
          throw new Error('Public key missing');
        }
        return createClerkClient({
          secretKey: process.env['CLERK_SECRET_KEY'],
          publishableKey: process.env['CLERK_PUBLISHABLE_KEY'],
        });
      },
    },
    ClerkAuthGuard,
  ],
  exports: ['CLERK_CLIENT', ClerkAuthGuard],
})
export class AuthModule {}

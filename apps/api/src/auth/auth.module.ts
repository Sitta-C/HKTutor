// src/auth/auth.module.ts
import { Module, Global} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { ClerkAuthGuard } from './auth.guard';

@Global()
@Module({
  providers: [
    {
      provide: 'CLERK_CLIENT',
      useFactory: () => {
        if(!process.env['CLERK_SECRET_KEY']){
            throw new Error('Secret key missing');
        }
        return createClerkClient({ secretKey: process.env['CLERK_SECRET_KEY'] });
      },
    },
    ClerkAuthGuard,
  ],
  exports: ['CLERK_CLIENT', ClerkAuthGuard],
})
export class AuthModule {}


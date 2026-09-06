// src/auth/auth.module.ts
import { createClerkClient } from '@clerk/backend';
import { Module, Global } from '@nestjs/common';

import { TestController } from '@/testAPI/test.controller';
import { TestService } from '@/testAPI/test.service';

@Global()
@Module({
  controllers: [TestController],
  providers: [
    {
      provide: 'CLERK_CLIENT',
      useFactory: () => {
        if (!process.env['CLERK_SECRET_KEY']) {
          throw new Error('Secret key missing');
        }
        return createClerkClient({ secretKey: process.env['CLERK_SECRET_KEY'] });
      },
    },
    TestService,
  ],
  exports: ['CLERK_CLIENT', TestService],
})
export class TestModule {}

import { Module } from '@nestjs/common';

import { AuthExampleController } from '@/examples/auth-example.controller';

@Module({
  controllers: [AuthExampleController],
})
export class AuthExampleModule {}

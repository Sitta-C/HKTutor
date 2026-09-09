import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { AuthModule } from '@/auth/auth.module';
import { validateAuthEnvironment } from '@/config/auth.config';
import { validateDatabaseEnvironment } from '@/config/database.config';
import { DatabaseModule } from '@/database/database.module';
import { AuthExampleModule } from '@/examples/auth-example.module';
import { HealthModule } from '@/health/health.module';
import { TutorsModule } from '@/tutors/tutors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: (config) => validateAuthEnvironment(validateDatabaseEnvironment(config)),
    }),
    ThrottlerModule.forRoot([{ limit: 100, ttl: 60_000 }]),
    DatabaseModule,
    HealthModule,
    AuthModule,
    AuthExampleModule,
    TutorsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

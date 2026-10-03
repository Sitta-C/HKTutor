import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { validateAuthEnvironment } from '@config/auth.config';
import { validateDatabaseEnvironment } from '@config/database.config';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { AuthModule } from '@modules/auth/auth.module';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { HealthModule } from '@modules/health/health.module';
import { ProfilesModule } from '@modules/profiles/profiles.module';
import { TutorsModule } from '@modules/tutors/tutors.module';

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
    BookingsModule,
    ConversationsModule,
    HealthModule,
    AuthModule,
    ProfilesModule,
    TutorsModule,
  ],
})
export class AppModule {}

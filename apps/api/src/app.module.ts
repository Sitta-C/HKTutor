import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { validateAuthEnvironment } from '@config/auth.config';
import { validateDatabaseEnvironment } from '@config/database.config';
import { validateStorageEnvironment } from '@config/storage.config';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AvatarsModule } from '@modules/avatars/avatars.module';
import { BookingsModule } from '@modules/bookings/bookings.module';
import { HealthModule } from '@modules/health/health.module';
import { ProfilesModule } from '@modules/profiles/profiles.module';
import { QualificationDocumentsModule } from '@modules/qualification-documents/qualification-documents.module';
import { TutorsModule } from '@modules/tutors/tutors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: (config) =>
        validateStorageEnvironment(validateAuthEnvironment(validateDatabaseEnvironment(config))),
    }),
    ThrottlerModule.forRoot([{ limit: 100, ttl: 60_000 }]),
    DatabaseModule,
    StorageModule,
    BookingsModule,
    HealthModule,
    AuthModule,
    AvatarsModule,
    ProfilesModule,
    QualificationDocumentsModule,
    TutorsModule,
  ],
})
export class AppModule {}

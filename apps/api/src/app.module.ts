import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { validateDatabaseEnvironment } from '@/config/database.config';
import { DatabaseModule } from '@/database/database.module';
import { HealthModule } from '@/health/health.module';
import { TutorsModule } from '@/tutors/tutors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: validateDatabaseEnvironment,
    }),
    DatabaseModule,
    HealthModule,
    TutorsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
